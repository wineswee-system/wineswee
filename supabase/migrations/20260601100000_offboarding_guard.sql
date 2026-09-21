-- ════════════════════════════════════════════════════════════
-- 離職交接守衛
-- ════════════════════════════════════════════════════════════
--
-- 功能：
--   1. employee_delegate_log 表 — 記錄每次交接，支援日後轉交回
--   2. get_employee_offboarding_items(p_emp_id) — 查詢受影響項目
--   3. resign_employee(...) — 原子執行：鏈轉交 + 快照更新 +
--                             門市/部門主管更新 + 狀態設離職 + 審計日誌
--   4. trg_emp_resign_chain_warn — 若繞過 RPC 直接改狀態，
--                                  仍留下審計警告（Studio 補網）
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. employee_delegate_log ────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_delegate_log (
  id                   SERIAL PRIMARY KEY,
  original_emp_id      INT  NOT NULL REFERENCES public.employees(id),
  delegate_emp_id      INT  NOT NULL REFERENCES public.employees(id),
  trigger_action       TEXT NOT NULL,          -- '離職' | '留職停薪' | '手動'
  chain_step_ids       INT[] NOT NULL DEFAULT '{}',
  snapshot_ids         INT[] NOT NULL DEFAULT '{}',
  store_ids            INT[] NOT NULL DEFAULT '{}',
  dept_ids             INT[] NOT NULL DEFAULT '{}',
  authorized_by_emp_id INT  REFERENCES public.employees(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                TEXT,
  is_reversed          BOOLEAN NOT NULL DEFAULT FALSE,
  reversed_at          TIMESTAMPTZ,
  reversed_by_emp_id   INT  REFERENCES public.employees(id)
);

-- ── 2. get_employee_offboarding_items ───────────────────

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
  v_shifts     INT;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN NULL; END IF;

  -- Approval chain steps where this person is the fixed approver
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',         cs.id,
    'chain_id',   cs.chain_id,
    'chain_name', ac.name,
    'label',      COALESCE(cs.label, cs.role_name, '第' || (cs.step_order + 1) || '關'),
    'step_order', cs.step_order
  ) ORDER BY ac.name, cs.step_order), '[]'::jsonb)
  INTO v_steps
  FROM public.approval_chain_steps cs
  JOIN public.approval_chains ac ON ac.id = cs.chain_id
  WHERE cs.target_type = 'fixed_emp' AND cs.target_emp_id = p_emp_id;

  -- Snapshots (in-flight requests) pointing to this person in the last 90 days
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',           s.id,
    'request_type', s.request_type,
    'request_id',   s.request_id,
    'step_order',   s.step_order,
    'label',        COALESCE(s.label, s.role_name)
  ) ORDER BY s.snapshotted_at DESC), '[]'::jsonb)
  INTO v_snapshots
  FROM public.request_chain_snapshots s
  WHERE s.target_emp_id = p_emp_id
    AND s.target_type   = 'fixed_emp'
    AND s.snapshotted_at > NOW() - INTERVAL '90 days';

  -- Stores where this person is manager
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name)), '[]'::jsonb)
  INTO v_stores
  FROM public.stores s WHERE s.manager_id = p_emp_id;

  -- Departments where this person is manager
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name)), '[]'::jsonb)
  INTO v_depts
  FROM public.departments d WHERE d.manager_id = p_emp_id;

  -- Upcoming shift count
  SELECT COUNT(*) INTO v_shifts
  FROM public.schedules
  WHERE employee = v_emp.name AND date >= CURRENT_DATE;

  RETURN jsonb_build_object(
    'employee',       jsonb_build_object('id', v_emp.id, 'name', v_emp.name),
    'chain_steps',    v_steps,
    'snapshots',      v_snapshots,
    'managed_stores', v_stores,
    'managed_depts',  v_depts,
    'upcoming_shifts', v_shifts
  );
END $$;


-- ── 3. resign_employee ──────────────────────────────────
--
-- 三個獨立 delegate 欄位：
--   p_chain_delegate_id  — 承接簽核鏈關卡 + 在飛快照
--   p_store_delegate_id  — 承接門市主管職
--   p_dept_delegate_id   — 承接部門主管職
-- 三個可以是同一人也可以不同人。

CREATE OR REPLACE FUNCTION public.resign_employee(
  p_emp_id               INT,
  p_new_status           TEXT,               -- '離職' | '留職停薪'
  p_resign_date          DATE    DEFAULT NULL,
  p_chain_delegate_id    INT     DEFAULT NULL,
  p_store_delegate_id    INT     DEFAULT NULL,
  p_dept_delegate_id     INT     DEFAULT NULL,
  p_authorized_by_emp_id INT     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp           public.employees;
  v_chain_del     public.employees;
  v_store_del     public.employees;
  v_dept_del      public.employees;
  v_step_ids      INT[];
  v_snap_ids      INT[];
  v_store_ids     INT[];
  v_dept_ids      INT[];
  v_log_id        INT;
  v_auth_name     TEXT;
BEGIN
  IF p_new_status NOT IN ('離職', '留職停薪') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 查操作人名稱（供 audit_logs.user）
  SELECT name INTO v_auth_name FROM public.employees WHERE id = p_authorized_by_emp_id;

  -- ── Validate each delegate ──────────────────────────
  -- 三個都不能是員工本人（否則轉給自己後狀態改離職，chain 仍指向離職員工）

  IF p_chain_delegate_id IS NOT NULL THEN
    IF p_chain_delegate_id = p_emp_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CHAIN_DELEGATE_CANNOT_BE_SELF');
    END IF;
    SELECT * INTO v_chain_del FROM public.employees
    WHERE id = p_chain_delegate_id AND status = '在職';
    IF v_chain_del.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'CHAIN_DELEGATE_NOT_ACTIVE');
    END IF;
  END IF;

  IF p_store_delegate_id IS NOT NULL THEN
    IF p_store_delegate_id = p_emp_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'STORE_DELEGATE_CANNOT_BE_SELF');
    END IF;
    SELECT * INTO v_store_del FROM public.employees
    WHERE id = p_store_delegate_id AND status = '在職';
    IF v_store_del.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'STORE_DELEGATE_NOT_ACTIVE');
    END IF;
  END IF;

  IF p_dept_delegate_id IS NOT NULL THEN
    IF p_dept_delegate_id = p_emp_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'DEPT_DELEGATE_CANNOT_BE_SELF');
    END IF;
    SELECT * INTO v_dept_del FROM public.employees
    WHERE id = p_dept_delegate_id AND status = '在職';
    IF v_dept_del.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'DEPT_DELEGATE_NOT_ACTIVE');
    END IF;
  END IF;

  -- ── Chain steps + snapshots ─────────────────────────

  IF p_chain_delegate_id IS NOT NULL THEN
    SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::INT[]) INTO v_step_ids
    FROM public.approval_chain_steps
    WHERE target_type = 'fixed_emp' AND target_emp_id = p_emp_id;

    IF COALESCE(array_length(v_step_ids, 1), 0) > 0 THEN
      UPDATE public.approval_chain_steps
      SET target_emp_id = p_chain_delegate_id
      WHERE id = ANY(v_step_ids);
    END IF;

    SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::INT[]) INTO v_snap_ids
    FROM public.request_chain_snapshots
    WHERE target_type = 'fixed_emp' AND target_emp_id = p_emp_id;

    IF COALESCE(array_length(v_snap_ids, 1), 0) > 0 THEN
      UPDATE public.request_chain_snapshots
      SET target_emp_id = p_chain_delegate_id
      WHERE id = ANY(v_snap_ids);
    END IF;
  END IF;

  -- ── Managed stores ──────────────────────────────────

  IF p_store_delegate_id IS NOT NULL THEN
    SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::INT[]) INTO v_store_ids
    FROM public.stores WHERE manager_id = p_emp_id;

    IF COALESCE(array_length(v_store_ids, 1), 0) > 0 THEN
      UPDATE public.stores SET manager_id = p_store_delegate_id
      WHERE id = ANY(v_store_ids);
    END IF;
  END IF;

  -- ── Managed departments ─────────────────────────────

  IF p_dept_delegate_id IS NOT NULL THEN
    SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::INT[]) INTO v_dept_ids
    FROM public.departments WHERE manager_id = p_emp_id;

    IF COALESCE(array_length(v_dept_ids, 1), 0) > 0 THEN
      UPDATE public.departments SET manager_id = p_dept_delegate_id
      WHERE id = ANY(v_dept_ids);
    END IF;
  END IF;

  -- ── Delegate log (以 chain delegate 為主記錄人) ─────

  INSERT INTO public.employee_delegate_log (
    original_emp_id, delegate_emp_id, trigger_action,
    chain_step_ids, snapshot_ids, store_ids, dept_ids,
    authorized_by_emp_id, notes
  ) VALUES (
    p_emp_id,
    COALESCE(p_chain_delegate_id, p_store_delegate_id, p_dept_delegate_id, p_emp_id),
    p_new_status,
    COALESCE(v_step_ids,  ARRAY[]::INT[]),
    COALESCE(v_snap_ids,  ARRAY[]::INT[]),
    COALESCE(v_store_ids, ARRAY[]::INT[]),
    COALESCE(v_dept_ids,  ARRAY[]::INT[]),
    p_authorized_by_emp_id,
    -- 記錄各類別承接人（三人可能不同）
    CASE
      WHEN p_chain_delegate_id IS DISTINCT FROM p_store_delegate_id
        OR p_chain_delegate_id IS DISTINCT FROM p_dept_delegate_id
      THEN 'chain:' || COALESCE(v_chain_del.name,'—')
        || ' store:' || COALESCE(v_store_del.name,'—')
        || ' dept:'  || COALESCE(v_dept_del.name,'—')
      ELSE NULL
    END
  ) RETURNING id INTO v_log_id;

  -- ── Audit log ───────────────────────────────────────

  INSERT INTO public.audit_logs ("user", action, target, target_table, target_id, old_value, new_value)
  VALUES (
    v_auth_name,
    'resign_with_handoff',
    v_emp.name,
    'employees',
    p_emp_id,
    'status: ' || COALESCE(v_emp.status, '在職'),
    'status: '      || p_new_status
      || ' | chain_del: ' || COALESCE(v_chain_del.name, '無')
      || ' | store_del: ' || COALESCE(v_store_del.name, '無')
      || ' | dept_del: '  || COALESCE(v_dept_del.name,  '無')
      || ' | steps: '     || COALESCE(array_length(v_step_ids,  1), 0)::text
      || ' | snaps: '     || COALESCE(array_length(v_snap_ids,  1), 0)::text
  );

  -- ── Update employee ─────────────────────────────────

  UPDATE public.employees
  SET status      = p_new_status,
      resign_date = COALESCE(p_resign_date, resign_date)
  WHERE id = p_emp_id;

  RETURN jsonb_build_object(
    'ok',                true,
    'log_id',            v_log_id,
    'chain_steps_count', COALESCE(array_length(v_step_ids,  1), 0),
    'snapshots_count',   COALESCE(array_length(v_snap_ids,  1), 0),
    'stores_count',      COALESCE(array_length(v_store_ids, 1), 0),
    'depts_count',       COALESCE(array_length(v_dept_ids,  1), 0)
  );
END $$;


-- ── 4. 補網觸發器：繞過 RPC 直接改狀態時留下警告 ─────────

CREATE OR REPLACE FUNCTION public._trg_emp_resign_chain_warn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_chain_count INT;
BEGIN
  IF NEW.status IN ('離職', '留職停薪')
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN

    SELECT COUNT(*) INTO v_chain_count
    FROM public.approval_chain_steps
    WHERE target_type = 'fixed_emp' AND target_emp_id = NEW.id;

    IF v_chain_count > 0 THEN
      INSERT INTO public.audit_logs (action, target, target_table, target_id, old_value, new_value)
      VALUES (
        'resign_chain_orphan_warning',
        NEW.name, 'employees', NEW.id,
        'status: ' || COALESCE(OLD.status, ''),
        'status: ' || NEW.status
          || ' | chain_steps_still_pointing: ' || v_chain_count
          || ' | WARNING: bypassed resign_employee RPC'
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_emp_resign_chain_warn ON public.employees;
CREATE TRIGGER trg_emp_resign_chain_warn
  AFTER UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public._trg_emp_resign_chain_warn();


COMMIT;

NOTIFY pgrst, 'reload schema';
