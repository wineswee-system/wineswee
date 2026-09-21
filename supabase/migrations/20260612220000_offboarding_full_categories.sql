-- ════════════════════════════════════════════════════════════════════════════
-- 離職交接補齊（Stage 1）：在現有 offboarding 上加
--   • 課別督導（department_sections.supervisor_id）
--   • 加簽（approval_extra_steps.assignee_id, pending）
--   • 名下任務（tasks.assignee_id, active）
--   • 直屬下屬（employees.supervisor_id / reporting_to）
--   • mode：transfer（交接/永久）| proxy（代理/可再轉手）
--
-- 不動簽核解析核心。代理也是直接搬 record，但 log 記下搬了哪些 id，
-- 之後「再轉給別人」靠 log 的 id 精準轉移（Stage 2）。
-- 既有 3 delegate 參數保留，新增參數放最後（向下相容）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. log 表補欄位 ──
ALTER TABLE public.employee_delegate_log
  ADD COLUMN IF NOT EXISTS mode            TEXT NOT NULL DEFAULT 'transfer'
    CHECK (mode IN ('transfer','proxy')),
  ADD COLUMN IF NOT EXISTS section_ids     INT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS extra_step_ids  INT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS task_ids        INT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS subordinate_ids INT[] NOT NULL DEFAULT '{}';


-- ── 2. 盤點函式：加 4 類 ──
CREATE OR REPLACE FUNCTION public.get_employee_offboarding_items(p_emp_id INT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp        public.employees;
  v_steps      JSONB;
  v_snapshots  JSONB;
  v_stores     JSONB;
  v_depts      JSONB;
  v_sections   JSONB;
  v_extras     INT;
  v_tasks      INT;
  v_subs       JSONB;
  v_shifts     INT;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', cs.id, 'chain_id', cs.chain_id, 'chain_name', ac.name,
    'label', COALESCE(cs.label, cs.role_name, '第' || (cs.step_order + 1) || '關'),
    'step_order', cs.step_order
  ) ORDER BY ac.name, cs.step_order), '[]'::jsonb)
  INTO v_steps
  FROM public.approval_chain_steps cs
  JOIN public.approval_chains ac ON ac.id = cs.chain_id
  WHERE cs.target_type = 'fixed_emp' AND cs.target_emp_id = p_emp_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'request_type', s.request_type, 'request_id', s.request_id,
    'step_order', s.step_order, 'label', COALESCE(s.label, s.role_name)
  ) ORDER BY s.snapshotted_at DESC), '[]'::jsonb)
  INTO v_snapshots
  FROM public.request_chain_snapshots s
  WHERE s.target_emp_id = p_emp_id AND s.target_type = 'fixed_emp'
    AND s.snapshotted_at > NOW() - INTERVAL '90 days';

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name)), '[]'::jsonb)
  INTO v_stores FROM public.stores s WHERE s.manager_id = p_emp_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name)), '[]'::jsonb)
  INTO v_depts FROM public.departments d WHERE d.manager_id = p_emp_id;

  -- ★ 新增：課別督導
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ds.id, 'name', ds.name)), '[]'::jsonb)
  INTO v_sections FROM public.department_sections ds WHERE ds.supervisor_id = p_emp_id;

  -- ★ 新增：待他處理的加簽
  SELECT COUNT(*) INTO v_extras
  FROM public.approval_extra_steps WHERE assignee_id = p_emp_id AND status = 'pending';

  -- ★ 新增：名下未完成任務
  SELECT COUNT(*) INTO v_tasks
  FROM public.tasks WHERE assignee_id = p_emp_id AND status IN ('進行中','待簽核','待確認');

  -- ★ 新增：直屬下屬
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name)), '[]'::jsonb)
  INTO v_subs FROM public.employees e
  WHERE e.status = '在職' AND (e.supervisor_id = p_emp_id OR e.reporting_to = p_emp_id);

  SELECT COUNT(*) INTO v_shifts
  FROM public.schedules WHERE employee = v_emp.name AND date >= CURRENT_DATE;

  RETURN jsonb_build_object(
    'employee',          jsonb_build_object('id', v_emp.id, 'name', v_emp.name),
    'chain_steps',       v_steps,
    'snapshots',         v_snapshots,
    'managed_stores',    v_stores,
    'managed_depts',     v_depts,
    'managed_sections',  v_sections,       -- ★
    'extra_signs',       v_extras,         -- ★
    'tasks',             v_tasks,          -- ★
    'subordinates',      v_subs,           -- ★
    'upcoming_shifts',   v_shifts
  );
END $$;


-- ── 3. resign_employee：加 section delegate + 加簽/任務/下屬 + mode ──
CREATE OR REPLACE FUNCTION public.resign_employee(
  p_emp_id               INT,
  p_new_status           TEXT,
  p_resign_date          DATE    DEFAULT NULL,
  p_chain_delegate_id    INT     DEFAULT NULL,
  p_store_delegate_id    INT     DEFAULT NULL,
  p_dept_delegate_id     INT     DEFAULT NULL,
  p_authorized_by_emp_id INT     DEFAULT NULL,
  p_section_delegate_id  INT     DEFAULT NULL,   -- ★ 課別督導承接人
  p_mode                 TEXT    DEFAULT 'transfer'  -- ★ transfer=交接 proxy=代理
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp        public.employees;
  v_chain_del  public.employees;
  v_store_del  public.employees;
  v_dept_del   public.employees;
  v_sec_del    public.employees;
  v_step_ids   INT[]; v_snap_ids INT[]; v_store_ids INT[]; v_dept_ids INT[];
  v_sec_ids    INT[]; v_extra_ids INT[]; v_task_ids INT[]; v_sub_ids INT[];
  v_log_id     INT;
  v_auth_name  TEXT;
BEGIN
  IF p_new_status NOT IN ('離職', '留職停薪') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  END IF;
  IF p_mode NOT IN ('transfer','proxy') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_MODE');
  END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;
  SELECT name INTO v_auth_name FROM public.employees WHERE id = p_authorized_by_emp_id;

  -- 驗證 delegate（不能是本人、須在職）
  IF p_chain_delegate_id IS NOT NULL THEN
    IF p_chain_delegate_id = p_emp_id THEN RETURN jsonb_build_object('ok', false, 'error', 'CHAIN_DELEGATE_CANNOT_BE_SELF'); END IF;
    SELECT * INTO v_chain_del FROM public.employees WHERE id = p_chain_delegate_id AND status = '在職';
    IF v_chain_del.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CHAIN_DELEGATE_NOT_ACTIVE'); END IF;
  END IF;
  IF p_store_delegate_id IS NOT NULL THEN
    IF p_store_delegate_id = p_emp_id THEN RETURN jsonb_build_object('ok', false, 'error', 'STORE_DELEGATE_CANNOT_BE_SELF'); END IF;
    SELECT * INTO v_store_del FROM public.employees WHERE id = p_store_delegate_id AND status = '在職';
    IF v_store_del.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'STORE_DELEGATE_NOT_ACTIVE'); END IF;
  END IF;
  IF p_dept_delegate_id IS NOT NULL THEN
    IF p_dept_delegate_id = p_emp_id THEN RETURN jsonb_build_object('ok', false, 'error', 'DEPT_DELEGATE_CANNOT_BE_SELF'); END IF;
    SELECT * INTO v_dept_del FROM public.employees WHERE id = p_dept_delegate_id AND status = '在職';
    IF v_dept_del.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'DEPT_DELEGATE_NOT_ACTIVE'); END IF;
  END IF;
  IF p_section_delegate_id IS NOT NULL THEN
    IF p_section_delegate_id = p_emp_id THEN RETURN jsonb_build_object('ok', false, 'error', 'SECTION_DELEGATE_CANNOT_BE_SELF'); END IF;
    SELECT * INTO v_sec_del FROM public.employees WHERE id = p_section_delegate_id AND status = '在職';
    IF v_sec_del.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SECTION_DELEGATE_NOT_ACTIVE'); END IF;
  END IF;

  -- chain delegate → 簽核關卡 + 在飛快照 + 加簽 + 任務
  IF p_chain_delegate_id IS NOT NULL THEN
    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_step_ids
      FROM public.approval_chain_steps WHERE target_type='fixed_emp' AND target_emp_id=p_emp_id;
    IF COALESCE(array_length(v_step_ids,1),0)>0 THEN
      UPDATE public.approval_chain_steps SET target_emp_id=p_chain_delegate_id WHERE id=ANY(v_step_ids);
    END IF;

    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_snap_ids
      FROM public.request_chain_snapshots WHERE target_type='fixed_emp' AND target_emp_id=p_emp_id;
    IF COALESCE(array_length(v_snap_ids,1),0)>0 THEN
      UPDATE public.request_chain_snapshots SET target_emp_id=p_chain_delegate_id WHERE id=ANY(v_snap_ids);
    END IF;

    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_extra_ids
      FROM public.approval_extra_steps WHERE assignee_id=p_emp_id AND status='pending';
    IF COALESCE(array_length(v_extra_ids,1),0)>0 THEN
      UPDATE public.approval_extra_steps SET assignee_id=p_chain_delegate_id WHERE id=ANY(v_extra_ids);
    END IF;

    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_task_ids
      FROM public.tasks WHERE assignee_id=p_emp_id AND status IN ('進行中','待簽核','待確認');
    IF COALESCE(array_length(v_task_ids,1),0)>0 THEN
      UPDATE public.tasks SET assignee_id=p_chain_delegate_id WHERE id=ANY(v_task_ids);
    END IF;
  END IF;

  -- store delegate
  IF p_store_delegate_id IS NOT NULL THEN
    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_store_ids FROM public.stores WHERE manager_id=p_emp_id;
    IF COALESCE(array_length(v_store_ids,1),0)>0 THEN
      UPDATE public.stores SET manager_id=p_store_delegate_id WHERE id=ANY(v_store_ids);
    END IF;
  END IF;

  -- dept delegate → 部門主管 + 下屬報告對象
  IF p_dept_delegate_id IS NOT NULL THEN
    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_dept_ids FROM public.departments WHERE manager_id=p_emp_id;
    IF COALESCE(array_length(v_dept_ids,1),0)>0 THEN
      UPDATE public.departments SET manager_id=p_dept_delegate_id WHERE id=ANY(v_dept_ids);
    END IF;

    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_sub_ids
      FROM public.employees WHERE status='在職' AND (supervisor_id=p_emp_id OR reporting_to=p_emp_id);
    IF COALESCE(array_length(v_sub_ids,1),0)>0 THEN
      UPDATE public.employees SET supervisor_id=p_dept_delegate_id WHERE supervisor_id=p_emp_id;
      UPDATE public.employees SET reporting_to=p_dept_delegate_id WHERE reporting_to=p_emp_id;
    END IF;
  END IF;

  -- section delegate → 課別督導
  IF p_section_delegate_id IS NOT NULL THEN
    SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_sec_ids FROM public.department_sections WHERE supervisor_id=p_emp_id;
    IF COALESCE(array_length(v_sec_ids,1),0)>0 THEN
      UPDATE public.department_sections SET supervisor_id=p_section_delegate_id WHERE id=ANY(v_sec_ids);
    END IF;
  END IF;

  -- log
  INSERT INTO public.employee_delegate_log (
    original_emp_id, delegate_emp_id, trigger_action, mode,
    chain_step_ids, snapshot_ids, store_ids, dept_ids,
    section_ids, extra_step_ids, task_ids, subordinate_ids,
    authorized_by_emp_id
  ) VALUES (
    p_emp_id,
    COALESCE(p_chain_delegate_id, p_dept_delegate_id, p_store_delegate_id, p_section_delegate_id, p_emp_id),
    p_new_status, p_mode,
    COALESCE(v_step_ids,'{}'), COALESCE(v_snap_ids,'{}'), COALESCE(v_store_ids,'{}'), COALESCE(v_dept_ids,'{}'),
    COALESCE(v_sec_ids,'{}'), COALESCE(v_extra_ids,'{}'), COALESCE(v_task_ids,'{}'), COALESCE(v_sub_ids,'{}'),
    p_authorized_by_emp_id
  ) RETURNING id INTO v_log_id;

  INSERT INTO public.audit_logs ("user", action, target, target_table, target_id, old_value, new_value)
  VALUES (v_auth_name, 'resign_with_handoff', v_emp.name, 'employees', p_emp_id,
    'status: ' || COALESCE(v_emp.status,'在職'),
    'status: ' || p_new_status || ' | mode: ' || p_mode
      || ' | chain: ' || COALESCE(v_chain_del.name,'無')
      || ' | dept: '  || COALESCE(v_dept_del.name,'無')
      || ' | store: ' || COALESCE(v_store_del.name,'無')
      || ' | section: ' || COALESCE(v_sec_del.name,'無'));

  -- ── 離職者本人善後（對齊舊 apply_employee_resignation）──
  IF p_new_status = '離職' THEN
    -- 取消他自己送的待審單
    UPDATE leave_requests    SET status='已取消' WHERE employee_id=p_emp_id AND status='待審核';
    UPDATE overtime_requests SET status='已取消' WHERE employee_id=p_emp_id AND status='待審核';
    UPDATE clock_corrections SET status='已取消' WHERE employee=v_emp.name AND status='待審核';
    UPDATE business_trips     SET status='已取消' WHERE employee=v_emp.name AND status='待審核';
    -- 刪離職日後的班表
    DELETE FROM schedules WHERE employee_id=p_emp_id AND date > COALESCE(p_resign_date, CURRENT_DATE);
    -- 關閉 active 主要 assignment
    UPDATE employee_assignments SET end_date=COALESCE(p_resign_date, CURRENT_DATE), is_active=false
     WHERE employee_id=p_emp_id AND department_type='主要' AND is_active=true;
  END IF;

  UPDATE public.employees
  SET status = p_new_status, resign_date = COALESCE(p_resign_date, resign_date)
  WHERE id = p_emp_id;

  RETURN jsonb_build_object(
    'ok', true, 'log_id', v_log_id, 'mode', p_mode,
    'chain_steps_count', COALESCE(array_length(v_step_ids,1),0),
    'snapshots_count',   COALESCE(array_length(v_snap_ids,1),0),
    'stores_count',      COALESCE(array_length(v_store_ids,1),0),
    'depts_count',       COALESCE(array_length(v_dept_ids,1),0),
    'sections_count',    COALESCE(array_length(v_sec_ids,1),0),
    'extras_count',      COALESCE(array_length(v_extra_ids,1),0),
    'tasks_count',       COALESCE(array_length(v_task_ids,1),0),
    'subordinates_count',COALESCE(array_length(v_sub_ids,1),0)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.resign_employee(INT, TEXT, DATE, INT, INT, INT, INT, INT, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_employee_offboarding_items(INT)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
