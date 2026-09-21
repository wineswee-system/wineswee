-- 簽核鏈凍結「開單當下」簽核人 + 快照 matcher 支援代簽 — 2026-07-16
-- 背景:主管即將大異動。舊單要吃開單當下的簽核人,不隨主管換人漂移;凍結人離職→其代理人可簽。
-- 手法(純加不改,不重寫既有分支;resolve/matcher 用 dump-live 原文外科插入):
--   1) request_chain_snapshots 加 frozen_emp_ids INT[]
--   2) _snapshot_chain_for_request / _snapshot_settle_chain 建快照時凍結當下簽核人
--   3) resolve_snapshot_step_approvers 頂端 guard:frozen 有值→只回凍結人(在職)+代理人
--   4) _employee_matches_snapshot_step 頂端 guard:frozen 有值→只認凍結人或其代理人
--   frozen=NULL 的舊單 → 行為完全不變。idempotent。

ALTER TABLE public.request_chain_snapshots
  ADD COLUMN IF NOT EXISTS frozen_emp_ids INT[];
COMMENT ON COLUMN public.request_chain_snapshots.frozen_emp_ids IS
  '送出時凍結的簽核人 employee id。有值時 resolve/matcher 只認這些人(+代理人),不再動態解析主管鏈。NULL=舊單照舊動態。';

-- ═══════════ _snapshot_chain_for_request ═══════════
CREATE OR REPLACE FUNCTION public._snapshot_chain_for_request(p_request_type text, p_request_id integer, p_chain_id integer, p_applicant_emp_id integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_step        public.approval_chain_steps;
  v_approver_ct INT;
  v_auto_skip   BOOLEAN;
BEGIN
  IF p_chain_id IS NULL THEN RETURN; END IF;

  FOR v_step IN
    SELECT * FROM public.approval_chain_steps
     WHERE chain_id = p_chain_id
     ORDER BY step_order
  LOOP
    v_auto_skip := FALSE;

    -- 預先判斷：若此步勾了「找不到時自動跳過」且有申請人 id
    IF v_step.skip_if_no_approver AND p_applicant_emp_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_approver_ct
        FROM public.resolve_chain_step_approvers(v_step.id, p_applicant_emp_id);
      v_auto_skip := (v_approver_ct = 0);
    END IF;

    INSERT INTO public.request_chain_snapshots (
      request_type, request_id, chain_id, step_order,
      label, role_name, target_type,
      target_emp_id, target_role_id, target_dept_id,
      target_store_id, target_section_id,
      skip_if_no_approver, auto_skipped,
      frozen_emp_ids
    ) VALUES (
      p_request_type, p_request_id, p_chain_id, v_step.step_order,
      v_step.label, v_step.role_name, v_step.target_type,
      v_step.target_emp_id, v_step.target_role_id, v_step.target_dept_id,
      v_step.target_store_id, v_step.target_section_id,
      v_step.skip_if_no_approver, v_auto_skip,
      CASE WHEN p_applicant_emp_id IS NOT NULL THEN
        NULLIF(ARRAY(SELECT emp_id FROM public.resolve_chain_step_approvers(v_step.id, p_applicant_emp_id)), '{}')
      ELSE NULL END
    )
    ON CONFLICT (request_type, request_id, step_order) DO NOTHING;
  END LOOP;
END $function$;

-- ═══════════ _snapshot_settle_chain ═══════════
CREATE OR REPLACE FUNCTION public._snapshot_settle_chain(p_request_id integer, p_chain_id integer, p_employee_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_step            approval_chain_steps;
  v_resolved_emp_id INT;
BEGIN
  IF p_chain_id IS NULL THEN RETURN; END IF;

  DELETE FROM request_chain_snapshots
  WHERE request_type = 'expense_settle' AND request_id = p_request_id;

  FOR v_step IN
    SELECT * FROM approval_chain_steps
    WHERE chain_id = p_chain_id ORDER BY step_order
  LOOP
    IF v_step.target_type IN (
      'applicant_supervisor', 'applicant_dept_manager', 'applicant_section_supervisor'
    ) THEN
      SELECT emp_id INTO v_resolved_emp_id
      FROM resolve_chain_step_approvers(v_step.id, p_employee_id)
      LIMIT 1;
    ELSE
      v_resolved_emp_id := v_step.target_emp_id;
    END IF;

    INSERT INTO public.request_chain_snapshots (
      request_type, request_id, chain_id, step_order,
      label, role_name, target_type,
      target_emp_id, target_role_id, target_dept_id,
      target_store_id, target_section_id,
      frozen_emp_ids
    ) VALUES (
      'expense_settle', p_request_id, p_chain_id, v_step.step_order,
      v_step.label, v_step.role_name, v_step.target_type,
      COALESCE(v_resolved_emp_id, v_step.target_emp_id),
      v_step.target_role_id, v_step.target_dept_id,
      v_step.target_store_id, v_step.target_section_id,
      NULLIF(ARRAY(SELECT emp_id FROM resolve_chain_step_approvers(v_step.id, p_employee_id)), '{}')
    )
    ON CONFLICT (request_type, request_id, step_order) DO UPDATE SET
      chain_id      = EXCLUDED.chain_id,
      label         = EXCLUDED.label,
      role_name     = EXCLUDED.role_name,
      target_type   = EXCLUDED.target_type,
      target_emp_id = EXCLUDED.target_emp_id,
      frozen_emp_ids = EXCLUDED.frozen_emp_ids,
      snapshotted_at = NOW();
  END LOOP;
END $function$;

-- ═══════════ resolve_snapshot_step_approvers(dump-live + 頂端 guard) ═══════════
CREATE OR REPLACE FUNCTION public.resolve_snapshot_step_approvers(p_request_type text, p_request_id integer, p_step_order integer, p_applicant_emp_id integer)
 RETURNS TABLE(emp_id integer, emp_name text, line_user_id text, channel_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_snap          public.request_chain_snapshots;
  v_app           employees;
  v_target_emp_id INT;
  v_section_id    INT;
  v_store_id      INT;
BEGIN
  SELECT * INTO v_snap
    FROM public.request_chain_snapshots
   WHERE request_type = p_request_type
     AND request_id   = p_request_id
     AND step_order   = p_step_order;
  IF v_snap.id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;

  -- ═══ 凍結簽核人優先(開單當下)+代簽:frozen 有值就只認這些人,不再動態解析 ═══
  IF v_snap.frozen_emp_ids IS NOT NULL AND array_length(v_snap.frozen_emp_ids, 1) > 0 THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e
      WHERE e.status = '在職'
        AND ( e.id = ANY(v_snap.frozen_emp_ids)
              OR EXISTS (
                SELECT 1 FROM approval_delegation_rules dr
                 WHERE dr.delegate_employee_id = e.id
                   AND dr.is_active
                   AND CURRENT_DATE >= dr.effective_from
                   AND (dr.effective_to IS NULL OR CURRENT_DATE <= dr.effective_to)
                   AND dr.delegator_employee_id = ANY(v_snap.frozen_emp_ids)
              ) );
    RETURN;
  END IF;


  -- ─────── fixed_* ───────
  IF v_snap.target_type = 'fixed_emp' AND v_snap.target_emp_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.id = v_snap.target_emp_id AND e.status = '在職';
    RETURN;
  END IF;

  IF v_snap.target_type = 'fixed_role' AND v_snap.target_role_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.role_id = v_snap.target_role_id AND e.status = '在職'
        AND (v_app.organization_id IS NULL OR e.organization_id = v_app.organization_id);
    RETURN;
  END IF;

  IF v_snap.target_type = 'fixed_dept' AND v_snap.target_dept_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.department_id = v_snap.target_dept_id AND e.status = '在職';
    RETURN;
  END IF;

  IF v_app.id IS NULL THEN RETURN; END IF;

  -- ─────── applicant_supervisor L1/L2/L3 ───────
  IF v_snap.target_type = 'applicant_supervisor' THEN
    v_target_emp_id := COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- ★ L2
  IF v_snap.target_type = 'applicant_supervisor_l2' THEN
    v_target_emp_id := COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_target_emp_id IS NOT NULL THEN
      SELECT COALESCE(e.supervisor_id, e.reporting_to) INTO v_target_emp_id
        FROM employees e WHERE e.id = v_target_emp_id;
      IF v_target_emp_id IS NOT NULL THEN
        RETURN QUERY
          SELECT e.id, e.name,
            (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
            (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
          FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
      END IF;
    END IF;
    RETURN;
  END IF;

  -- ★ L3
  IF v_snap.target_type = 'applicant_supervisor_l3' THEN
    v_target_emp_id := COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_target_emp_id IS NOT NULL THEN
      SELECT COALESCE(e.supervisor_id, e.reporting_to) INTO v_target_emp_id
        FROM employees e WHERE e.id = v_target_emp_id;
      IF v_target_emp_id IS NOT NULL THEN
        SELECT COALESCE(e.supervisor_id, e.reporting_to) INTO v_target_emp_id
          FROM employees e WHERE e.id = v_target_emp_id;
        IF v_target_emp_id IS NOT NULL THEN
          RETURN QUERY
            SELECT e.id, e.name,
              (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
              (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
            FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
        END IF;
      END IF;
    END IF;
    RETURN;
  END IF;

  -- ─────── 其餘 applicant_* ───────
  IF v_snap.target_type = 'applicant_dept_manager' AND v_app.department_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_app.department_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'applicant_store_manager' AND v_app.store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_app.store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'applicant_store_supervisor' AND v_app.store_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e
      WHERE e.store_id = v_app.store_id
        AND e.position = '督導'
        AND e.status = '在職';
    RETURN;
  END IF;

  IF v_snap.target_type = 'applicant_section_supervisor' THEN
    -- 1. 申請人門市綁的課別的督導
    IF v_app.store_id IS NOT NULL THEN
      SELECT s.section_id INTO v_section_id FROM stores s WHERE s.id = v_app.store_id;
      IF v_section_id IS NOT NULL THEN
        SELECT ds.supervisor_id INTO v_target_emp_id
          FROM department_sections ds WHERE ds.id = v_section_id;
        IF v_target_emp_id IS NOT NULL THEN
          RETURN QUERY
            SELECT e.id, e.name,
              (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
              (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
            FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
          RETURN;   -- ★ 找到門市課別督導就結束
        END IF;
      END IF;
    END IF;
    -- 2. self-fallback：門市未綁課別 / 課別無督導，但申請人本身是某課督導 → 申請人自簽
    --    對齊 _employee_matches_chain_step 的 section_supervisor self case（不然簽得下去卻顯示不出人）
    IF EXISTS (SELECT 1 FROM department_sections WHERE supervisor_id = v_app.id) THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_app.id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- ─────── specific_* ───────
  IF v_snap.target_type = 'specific_dept_manager' AND v_snap.target_dept_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_snap.target_dept_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'specific_store_manager' AND v_snap.target_store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_snap.target_store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'specific_section_supervisor' AND v_snap.target_section_id IS NOT NULL THEN
    SELECT ds.supervisor_id INTO v_target_emp_id
      FROM department_sections ds WHERE ds.id = v_snap.target_section_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- ─────── 商品調撥 5 個 dynamic target ───────
  IF v_snap.target_type IN ('transfer_in_store_manager', 'transfer_out_store_manager') THEN
    v_store_id := public._goods_transfer_target_store(p_request_id,
      CASE v_snap.target_type WHEN 'transfer_in_store_manager' THEN 'to' ELSE 'from' END);
    IF v_store_id IS NOT NULL THEN
      SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_store_id;
      IF v_target_emp_id IS NOT NULL THEN
        RETURN QUERY
          SELECT e.id, e.name,
            (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
            (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
          FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
      END IF;
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type IN ('transfer_in_store_supervisor', 'transfer_out_store_supervisor') THEN
    v_store_id := public._goods_transfer_target_store(p_request_id,
      CASE v_snap.target_type WHEN 'transfer_in_store_supervisor' THEN 'to' ELSE 'from' END);
    IF v_store_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e
        WHERE e.store_id = v_store_id
          AND e.position = '督導'
          AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'warehouse_supervisor' THEN
    SELECT d.manager_id INTO v_target_emp_id
      FROM departments d
     WHERE d.name = '倉儲物流部'
       AND (v_app.organization_id IS NULL OR d.organization_id = v_app.organization_id)
     LIMIT 1;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  RETURN;
END $function$;

-- ═══════════ _employee_matches_snapshot_step(dump-live + 頂端 guard) ═══════════
CREATE OR REPLACE FUNCTION public._employee_matches_snapshot_step(p_emp_id integer, p_request_type text, p_request_id integer, p_step_order integer, p_applicant_emp_id integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_snap  public.request_chain_snapshots;
  v_emp   employees;
  v_app   employees;
  v_l1_id INT;
BEGIN
  SELECT * INTO v_snap
    FROM public.request_chain_snapshots
   WHERE request_type = p_request_type
     AND request_id   = p_request_id
     AND step_order   = p_step_order;
  IF v_snap.id IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id AND status = '在職';
  IF v_emp.id IS NULL THEN RETURN FALSE; END IF;

  -- ═══ 凍結簽核人優先(開單當下)+代簽 ═══
  IF v_snap.frozen_emp_ids IS NOT NULL AND array_length(v_snap.frozen_emp_ids, 1) > 0 THEN
    RETURN p_emp_id = ANY(v_snap.frozen_emp_ids)
        OR EXISTS (
          SELECT 1 FROM approval_delegation_rules dr
           WHERE dr.delegate_employee_id = p_emp_id
             AND dr.is_active
             AND CURRENT_DATE >= dr.effective_from
             AND (dr.effective_to IS NULL OR CURRENT_DATE <= dr.effective_to)
             AND dr.delegator_employee_id = ANY(v_snap.frozen_emp_ids)
        );
  END IF;

  IF v_snap.target_type = 'fixed_emp'  THEN RETURN v_snap.target_emp_id  = p_emp_id; END IF;
  IF v_snap.target_type = 'fixed_role' THEN RETURN v_snap.target_role_id = v_emp.role_id; END IF;
  IF v_snap.target_type = 'fixed_dept' THEN RETURN v_snap.target_dept_id = v_emp.department_id; END IF;

  IF p_applicant_emp_id IS NOT NULL THEN
    SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;
  END IF;

  IF v_snap.target_type = 'applicant_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN COALESCE(v_app.supervisor_id, v_app.reporting_to) = p_emp_id;
  END IF;

  IF v_snap.target_type = 'applicant_supervisor_l2' AND v_app.id IS NOT NULL THEN
    SELECT COALESCE(supervisor_id, reporting_to) INTO v_l1_id
      FROM employees WHERE id = COALESCE(v_app.supervisor_id, v_app.reporting_to);
    RETURN v_l1_id IS NOT NULL AND v_l1_id = p_emp_id;
  END IF;

  IF v_snap.target_type = 'applicant_supervisor_l3' AND v_app.id IS NOT NULL THEN
    SELECT COALESCE(supervisor_id, reporting_to) INTO v_l1_id
      FROM employees WHERE id = COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_l1_id IS NULL THEN RETURN FALSE; END IF;
    SELECT COALESCE(supervisor_id, reporting_to) INTO v_l1_id
      FROM employees WHERE id = v_l1_id;
    RETURN v_l1_id IS NOT NULL AND v_l1_id = p_emp_id;
  END IF;

  IF v_snap.target_type = 'applicant_dept_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_app.department_id AND d.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'applicant_store_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_app.store_id AND s.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'applicant_store_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (v_emp.store_id = v_app.store_id AND v_emp.position = '督導');
  END IF;

  IF v_snap.target_type = 'applicant_section_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (
      EXISTS (SELECT 1 FROM stores s
                JOIN department_sections ds ON ds.id = s.section_id
               WHERE s.id = v_app.store_id AND ds.supervisor_id = p_emp_id)
      OR (
        p_emp_id = v_app.id
        AND NOT EXISTS (SELECT 1 FROM stores s
                          JOIN department_sections ds ON ds.id = s.section_id
                         WHERE s.id = v_app.store_id AND ds.supervisor_id IS NOT NULL)
        AND EXISTS (SELECT 1 FROM department_sections WHERE supervisor_id = v_app.id)
      )
    );
  END IF;

  IF v_snap.target_type = 'specific_dept_manager' THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_snap.target_dept_id AND d.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'specific_store_manager' THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_snap.target_store_id AND s.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'specific_section_supervisor' THEN
    RETURN EXISTS (SELECT 1 FROM department_sections ds
                    WHERE ds.id = v_snap.target_section_id AND ds.supervisor_id = p_emp_id);
  END IF;

  -- ★ NEW：調撥/倉管（比照 resolve_snapshot_step_approvers；p_request_id = goods_transfer_requests.id）
  IF v_snap.target_type IN ('transfer_in_store_manager', 'transfer_out_store_manager') THEN
    RETURN EXISTS (SELECT 1 FROM stores s
      WHERE s.id = public._goods_transfer_target_store(p_request_id,
                     CASE v_snap.target_type WHEN 'transfer_in_store_manager' THEN 'to' ELSE 'from' END)
        AND s.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type IN ('transfer_in_store_supervisor', 'transfer_out_store_supervisor') THEN
    RETURN (v_emp.position = '督導'
            AND v_emp.store_id = public._goods_transfer_target_store(p_request_id,
                     CASE v_snap.target_type WHEN 'transfer_in_store_supervisor' THEN 'to' ELSE 'from' END));
  END IF;

  IF v_snap.target_type = 'warehouse_supervisor' THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.name = '倉儲物流部' AND d.manager_id = p_emp_id);
  END IF;

  RETURN FALSE;
END $function$;

NOTIFY pgrst, 'reload schema';
