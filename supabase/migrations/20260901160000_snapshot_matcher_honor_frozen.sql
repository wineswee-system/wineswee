-- 讓「凍結快照(frozen_emp_ids)」真正決定「輪到誰簽」,而不只是「誰看得到」。
--
-- 背景:簽核鏈是「就地改」的,舊單建立時已把當時的鏈凍成 request_chain_snapshots。
--   但 _employee_matches_snapshot_step(簽核路徑用)對動態關(直屬主管/督導/部門經理…)
--   是「當下重新解算」,沒吃 frozen_emp_ids → 鏈一改舊單就漂移。
--   resolve_snapshot_step_approvers 早已正確吃 frozen,本檔把 matcher 對齊它。
--
-- ① _employee_matches_snapshot_step:frozen 有值 → 只認名單成員(含代簽),不再動態解。
-- ② _emp_is_current_step_approver:待簽清單用的包裝 — 有快照走快照比對(已吃 frozen),
--    沒快照的舊單 fallback 回現行鏈比對(避免漏單)。

-- ─────────────────────────────────────────────────────────────
-- ① matcher 吃凍結名單
-- ─────────────────────────────────────────────────────────────
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

  -- ═══ ★ 凍結名單優先(開單當下)+代簽:frozen 有值就只認這些人,不再動態解 ═══
  --     對齊 resolve_snapshot_step_approvers,讓簽核路徑不因鏈/組織異動漂移。
  IF v_snap.frozen_emp_ids IS NOT NULL AND array_length(v_snap.frozen_emp_ids, 1) > 0 THEN
    IF p_emp_id = ANY(v_snap.frozen_emp_ids) THEN RETURN TRUE; END IF;
    IF EXISTS (
      SELECT 1 FROM approval_delegation_rules dr
       WHERE dr.delegate_employee_id = p_emp_id
         AND dr.is_active
         AND CURRENT_DATE >= dr.effective_from
         AND (dr.effective_to IS NULL OR CURRENT_DATE <= dr.effective_to)
         AND dr.delegator_employee_id = ANY(v_snap.frozen_emp_ids)
    ) THEN RETURN TRUE; END IF;
    RETURN FALSE;
  END IF;

  -- ═══ 以下為 frozen 為空時的動態 fallback(維持原邏輯) ═══
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

-- ─────────────────────────────────────────────────────────────
-- ② 待簽清單用的包裝:有快照走快照比對(吃 frozen),沒快照 fallback 現行鏈
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._emp_is_current_step_approver(
  p_emp_id integer, p_request_type text, p_request_id integer,
  p_chain_id integer, p_step_order integer, p_applicant_emp_id integer
)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_step_id INT;
BEGIN
  -- 有快照 → 用快照比對(已吃 frozen_emp_ids)
  IF EXISTS (SELECT 1 FROM public.request_chain_snapshots
              WHERE request_type = p_request_type AND request_id = p_request_id AND step_order = p_step_order) THEN
    RETURN public._employee_matches_snapshot_step(p_emp_id, p_request_type, p_request_id, p_step_order, p_applicant_emp_id);
  END IF;

  -- 沒快照(舊單/未 rollout) → fallback 現行鏈比對
  IF p_chain_id IS NULL THEN RETURN FALSE; END IF;
  SELECT id INTO v_step_id FROM public.approval_chain_steps
    WHERE chain_id = p_chain_id AND step_order = p_step_order LIMIT 1;
  IF v_step_id IS NULL THEN RETURN FALSE; END IF;
  RETURN public._employee_matches_chain_step(p_emp_id, v_step_id, p_applicant_emp_id);
END $function$;


-- ─────────────────────────────────────────────────────────────
-- ③ web 待簽清單:12 塊改用 _emp_is_current_step_approver(快照優先→吃凍結)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.web_list_my_pending_approval_ids()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  emp employees;
  result json;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF emp.id IS NULL THEN RETURN json_build_object('error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT json_build_object(
    'leave_requests', (
      SELECT COALESCE(json_agg(l.id), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id AND l.status = '待審核'
        AND l.deleted_at IS NULL
        AND ((l.approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(emp.id, 'leave_request', l.id, l.approval_chain_id, l.current_step, l.employee_id))
          OR (l.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)) AND COALESCE(l.employee_id, -1) <> emp.id))
    ),
    'overtime_requests', (
      SELECT COALESCE(json_agg(o.id), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核'
        AND o.deleted_at IS NULL
        AND ((o.approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(emp.id, 'overtime_request', o.id, o.approval_chain_id, o.current_step, o.employee_id))
          OR (o.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)) AND COALESCE(o.employee_id, -1) <> emp.id))
    ),
    'business_trips', (
      SELECT COALESCE(json_agg(t.id), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1) e_app ON true
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核'
        AND t.deleted_at IS NULL
        AND ((t.approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(emp.id, 'trip', t.id, t.approval_chain_id, t.current_step, e_app.id))
          OR (t.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))) AND COALESCE(e_app.id, -1) <> emp.id))
    ),
    'clock_corrections', (
      SELECT COALESCE(json_agg(c.id), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核'
        AND c.deleted_at IS NULL
        AND ((c.approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(emp.id, 'correction', c.id, c.approval_chain_id, c.current_step, e_app.id))
          OR (c.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id))
    ),
    'expenses', (
      SELECT COALESCE(json_agg(ex.id), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核'
        AND ((ex.approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(emp.id, 'expense', ex.id, ex.approval_chain_id, ex.current_step, e_app.id))
          OR (ex.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id))
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(er.id), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = er.approval_chain_id AND cs.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '申請中'
        AND er.deleted_at IS NULL
        AND er.approval_chain_id IS NOT NULL
        AND public._emp_is_current_step_approver(emp.id, 'expense_request', er.id, er.approval_chain_id, er.current_step, er.employee_id)
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(er.id), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = er.settle_chain_id AND cs.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '待核銷'
        AND er.deleted_at IS NULL
        AND er.settle_chain_id IS NOT NULL
        AND public._emp_is_current_step_approver(emp.id, 'expense_settle', er.id, er.settle_chain_id, er.settle_current_step, er.employee_id)
    ),
    'resignation_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.resignation_requests r
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND r.approval_chain_id IS NOT NULL
        AND public._emp_is_current_step_approver(emp.id, 'resignation', r.id, r.approval_chain_id, r.current_step, r.employee_id)
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.leave_of_absence_requests r
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND r.approval_chain_id IS NOT NULL
        AND public._emp_is_current_step_approver(emp.id, 'loa', r.id, r.approval_chain_id, r.current_step, r.employee_id)
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json)
      FROM public.personnel_transfer_requests r
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND r.approval_chain_id IS NOT NULL
        AND public._emp_is_current_step_approver(emp.id, 'transfer', r.id, r.approval_chain_id, r.current_step, r.employee_id)
    ),
    'headcount_requests', (
      SELECT COALESCE(json_agg(h.id), '[]'::json)
      FROM public.headcount_requests h
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = h.approval_chain_id AND cs.step_order = h.current_step
      WHERE h.organization_id = emp.organization_id AND h.status = '申請中'
        AND h.deleted_at IS NULL
        AND h.approval_chain_id IS NOT NULL
        AND public._emp_is_current_step_approver(emp.id, 'headcount', h.id, h.approval_chain_id, h.current_step, h.employee_id)
    ),

    -- 錄取(offer_letters):走專屬 offer_approval_steps,當關簽核人=我才回
    'offer_letters', (
      SELECT COALESCE(json_agg(o.id), '[]'::json)
      FROM public.offer_letters o
      JOIN public.offer_approval_steps s
        ON s.offer_id = o.id AND s.step_order = o.current_step AND s.status = '待審'
      WHERE o.organization_id = emp.organization_id
        AND o.status = '待審'
        AND s.approver_id = emp.id
    ),
    'form_submissions', (
      SELECT COALESCE(json_agg(s.id), '[]'::json)
      FROM public.form_submissions s
      JOIN public.form_templates t ON t.id = s.template_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = s.current_step
      WHERE s.organization_id = emp.organization_id AND s.status = '申請中'
        AND s.deleted_at IS NULL
        AND t.approval_chain_id IS NOT NULL
        AND public._emp_is_current_step_approver(emp.id, 'form_submission', s.id, t.approval_chain_id, s.current_step, s.applicant_id)
    ),
    'shift_swaps', (
      SELECT COALESCE(json_agg(ss.id), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND ss.deleted_at IS NULL
        AND ((ss.status = '待對方同意' AND ss.target_id = emp.id AND ss.requester_id <> emp.id)
          OR (ss.status = '待主管核准'
              AND ss.requester_id <> emp.id AND ss.target_id <> emp.id
              AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
                   OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))))
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(orr.id), '[]'::json)
      FROM public.off_requests orr
      WHERE orr.organization_id = emp.organization_id
        AND orr.status = '待審核'
        AND COALESCE(orr.employee_id, -1) <> emp.id
        -- 對齊 LIFF：只給組織圖解出的簽核人(supervisor 優先),不再用 schedule.approve 權限廣開
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(orr.employee_id))
    ),
    'task_confirmations', (
      SELECT COALESCE(json_agg(tc.id), '[]'::json)
      FROM public.task_confirmations tc
      JOIN public.tasks t ON t.id = tc.task_id
      WHERE t.organization_id = emp.organization_id
        AND tc.status = 'pending'
        AND tc.approver = emp.name
    ),
    -- ★ 新增：商品調撥申請 — snapshot-aware
    'goods_transfer_apply_requests', (
      SELECT COALESCE(json_agg(g.id), '[]'::json)
      FROM public.goods_transfer_requests g
      WHERE g.organization_id = emp.organization_id
        AND g.status = '申請審核中'
        AND g.deleted_at IS NULL
        AND g.current_chain_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.resolve_snapshot_step_approvers(
            'goods_transfer_apply', g.id, g.current_step, g.applicant_id
          ) a WHERE a.emp_id = emp.id
        )
    ),
    -- ★ 新增：商品調撥驗收
    'goods_transfer_receipt_requests', (
      SELECT COALESCE(json_agg(g.id), '[]'::json)
      FROM public.goods_transfer_requests g
      WHERE g.organization_id = emp.organization_id
        AND g.status = '驗收審核中'
        AND g.deleted_at IS NULL
        AND g.current_chain_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.resolve_snapshot_step_approvers(
            'goods_transfer_receipt', g.id, g.current_step, g.applicant_id
          ) a WHERE a.emp_id = emp.id
        )
    )
  ) INTO result;
  RETURN result;
END
$function$;

-- ─────────────────────────────────────────────────────────────
-- ④ LIFF 待簽清單:出差/費用/離職/留停/異動/人力需求 6 塊過濾改用 helper
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_pending_approvals(p_line_user_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp    employees;
  result json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object(
      'leaves','[]'::json,'overtimes','[]'::json,'trips','[]'::json,
      'expenses','[]'::json,'corrections','[]'::json,'expense_requests','[]'::json,
      'expense_settles','[]'::json,
      'resignation_requests','[]'::json,'leave_of_absence_requests','[]'::json,
      'personnel_transfer_requests','[]'::json,'headcount_requests','[]'::json,
      'form_submissions','[]'::json,
      'task_confirmations','[]'::json,
      'shift_swaps_for_peer','[]'::json,'shift_swaps_for_manager','[]'::json,
      'off_requests','[]'::json,
      'can', json_build_object('hr', false, 'finance', false)
    );
  END IF;

  SELECT json_build_object(
    'leaves', (
      SELECT COALESCE(json_agg(
        (to_jsonb(l.*) || jsonb_build_object(
          'my_step_label', COALESCE(snap_step.label, cs.label),
          'my_approver_role', CASE
            WHEN snap_step.id IS NOT NULL
              AND public._employee_matches_snapshot_step(emp.id, 'leave_request', l.id, l.current_step, l.employee_id) THEN snap_step.target_type
            WHEN snap_step.id IS NULL AND l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('leave_requests', l.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', l.employee_id = emp.id
        ))::json ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      LEFT JOIN public.request_chain_snapshots snap_step ON snap_step.request_type = 'leave_request' AND snap_step.request_id = l.id AND snap_step.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id AND l.status = '待審核'
        AND l.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((snap_step.id IS NOT NULL AND public._employee_matches_snapshot_step(emp.id, 'leave_request', l.id, l.current_step, l.employee_id))
          OR (snap_step.id IS NULL AND l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)) AND COALESCE(l.employee_id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('leave_requests', l.id, emp.id))
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(
        (to_jsonb(o.*) || jsonb_build_object(
          'my_step_label', COALESCE(snap_step.label, cs.label),
          'my_approver_role', CASE
            WHEN snap_step.id IS NOT NULL
              AND public._employee_matches_snapshot_step(emp.id, 'overtime_request', o.id, o.current_step, o.employee_id) THEN snap_step.target_type
            WHEN snap_step.id IS NULL AND o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('overtime_requests', o.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', o.employee_id = emp.id
        ))::json ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      LEFT JOIN public.request_chain_snapshots snap_step ON snap_step.request_type = 'overtime_request' AND snap_step.request_id = o.id AND snap_step.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核'
        AND o.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((snap_step.id IS NOT NULL AND public._employee_matches_snapshot_step(emp.id, 'overtime_request', o.id, o.current_step, o.employee_id))
          OR (snap_step.id IS NULL AND o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)) AND COALESCE(o.employee_id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('overtime_requests', o.id, emp.id))
    ),
    'trips', (
      SELECT COALESCE(json_agg(
        (to_jsonb(t.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('business_trips', t.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', e_app.id = emp.id
        ))::json ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1) e_app ON true
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核'
        AND t.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((t.approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(emp.id, 'trip', t.id, t.approval_chain_id, t.current_step, e_app.id))
          OR (t.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))) AND COALESCE(e_app.id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('business_trips', t.id, emp.id))
    ),
    'corrections', (
      SELECT COALESCE(json_agg(
        (to_jsonb(c.*) || jsonb_build_object(
          'my_step_label', COALESCE(snap_step.label, cs.label),
          'my_approver_role', CASE
            WHEN snap_step.id IS NOT NULL
              AND public._employee_matches_snapshot_step(emp.id, 'correction', c.id, c.current_step, e_app.id) THEN snap_step.target_type
            WHEN snap_step.id IS NULL AND c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('clock_corrections', c.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', e_app.id = emp.id
        ))::json ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      LEFT JOIN public.request_chain_snapshots snap_step ON snap_step.request_type = 'correction' AND snap_step.request_id = c.id AND snap_step.step_order = c.current_step
      WHERE c.status = '待審核'
        AND c.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((snap_step.id IS NOT NULL AND public._employee_matches_snapshot_step(emp.id, 'correction', c.id, c.current_step, e_app.id))
          OR (snap_step.id IS NULL AND c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id)
          OR public._has_pending_extra_for_me('clock_corrections', c.id, emp.id))
    ),
    'expenses', (
      -- expenses 表沒 deleted_at（不在 soft-delete 範圍）
      SELECT COALESCE(json_agg(
        (to_jsonb(ex.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('expenses', ex.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', e_app.id = emp.id
        ))::json ORDER BY ex.created_at DESC), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核'
        AND ((ex.approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(emp.id, 'expense', ex.id, ex.approval_chain_id, ex.current_step, e_app.id))
          OR (ex.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id)
          OR public._has_pending_extra_for_me('expenses', ex.id, emp.id))
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', er.id, 'employee', er.employee, 'department', er.department, 'title', er.title,
        'description', er.description, 'estimated_amount', er.estimated_amount,
        'account_code', er.account_code, 'account_name', er.account_name,
        'store', er.store, 'status', er.status, 'created_at', er.created_at,
        'reject_reason', er.reject_reason,
        'approval_chain_id', er.approval_chain_id, 'current_step', er.current_step,
        'chain_name', ac.name,
        'chain_total_steps', (SELECT COUNT(*) FROM approval_chain_steps WHERE chain_id = er.approval_chain_id),
        'my_step_label', COALESCE(snap_step.label, cur_step.label),
        'my_approver_role', CASE
          -- ★ 有快照 → 讀申請當下的快照（改 chain 不影響在飛單）
          WHEN snap_step.id IS NOT NULL
            AND public._employee_matches_snapshot_step(emp.id, 'expense_request', er.id, er.current_step, er.employee_id) THEN snap_step.target_type
          -- 沒快照(舊單) → fallback live chain
          WHEN snap_step.id IS NULL AND er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id) THEN cur_step.target_type
          WHEN public._has_pending_extra_for_me('expense_requests', er.id, emp.id) THEN 'extra_signer'
          ELSE NULL
        END,
        'is_self_approve', er.employee_id = emp.id
      ) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chains ac ON ac.id = er.approval_chain_id
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.approval_chain_id AND cur_step.step_order = er.current_step
      LEFT JOIN public.request_chain_snapshots snap_step ON snap_step.request_type = 'expense_request' AND snap_step.request_id = er.id AND snap_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '申請中'
        AND er.deleted_at IS NULL  -- ★ soft-delete filter
        AND (
          -- ★ 有快照 → 讀快照判斷（送出當下定住，改 chain 不影響）
          (snap_step.id IS NOT NULL AND public._employee_matches_snapshot_step(emp.id, 'expense_request', er.id, er.current_step, er.employee_id))
          -- 沒快照(舊單) → fallback live chain
          OR (snap_step.id IS NULL AND er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id))
          OR public._has_pending_extra_for_me('expense_requests', er.id, emp.id))
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(
        (to_jsonb(er.*) || jsonb_build_object(
          'my_step_label', COALESCE(snap_step.label, cur_step.label),
          'my_approver_role', COALESCE(snap_step.target_type, cur_step.target_type),
          'is_self_approve', er.employee_id = emp.id
        ))::json ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.settle_chain_id AND cur_step.step_order = er.settle_current_step
      LEFT JOIN public.request_chain_snapshots snap_step ON snap_step.request_type = 'expense_settle' AND snap_step.request_id = er.id AND snap_step.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '待核銷'
        AND er.deleted_at IS NULL  -- ★ soft-delete filter
        AND (
          (snap_step.id IS NOT NULL AND public._employee_matches_snapshot_step(emp.id, 'expense_settle', er.id, er.settle_current_step, er.employee_id))
          OR (snap_step.id IS NULL AND er.settle_chain_id IS NOT NULL AND cur_step.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id))
        )
    ),
    'resignation_requests', (
      -- resignation_requests 表沒 deleted_at（不在 soft-delete 範圍）
      SELECT COALESCE(json_agg(
        (to_jsonb(r.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('resignation_requests', r.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', r.employee_id = emp.id
        ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(emp.id, 'resignation', r.id, r.approval_chain_id, r.current_step, r.employee_id))
          OR public._has_pending_extra_for_me('resignation_requests', r.id, emp.id))
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(
        (to_jsonb(r.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', r.employee_id = emp.id
        ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(emp.id, 'loa', r.id, r.approval_chain_id, r.current_step, r.employee_id))
          OR public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id))
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(
        (to_jsonb(r.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', r.employee_id = emp.id
        ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(emp.id, 'transfer', r.id, r.approval_chain_id, r.current_step, r.employee_id))
          OR public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id))
    ),
    'headcount_requests', (
      SELECT COALESCE(json_agg(
        (to_jsonb(h.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('headcount_requests', h.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', h.employee_id = emp.id
        ))::json ORDER BY h.created_at DESC), '[]'::json)
      FROM public.headcount_requests h
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = h.approval_chain_id AND cs.step_order = h.current_step
      WHERE h.organization_id = emp.organization_id AND h.status = '申請中'
        AND h.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((h.approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(emp.id, 'headcount', h.id, h.approval_chain_id, h.current_step, h.employee_id))
          OR public._has_pending_extra_for_me('headcount_requests', h.id, emp.id))
    ),
    'form_submissions', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', s.id, 'template_id', s.template_id, 'template_name', t.name,
        'template_fields', t.fields,
        'applicant_id', s.applicant_id, 'applicant_name', e_app.name,
        'data', s.data, 'status', s.status, 'created_at', s.created_at,
        'current_step', s.current_step,
        'chain_id', t.approval_chain_id,
        'my_step_label', COALESCE(snap_step.label, cur_step.label),
        'my_approver_role', CASE
          WHEN snap_step.id IS NOT NULL
            AND public._employee_matches_snapshot_step(emp.id, 'form_submission', s.id, s.current_step, s.applicant_id) THEN snap_step.target_type
          WHEN snap_step.id IS NULL AND t.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, s.applicant_id) THEN cur_step.target_type
          WHEN public._has_pending_extra_for_me('form_submissions', s.id, emp.id) THEN 'extra_signer'
          ELSE NULL
        END,
        'is_self_approve', s.applicant_id = emp.id,
        'attachments', (
          SELECT COALESCE(json_agg(json_build_object(
            'id', a.id, 'file_name', a.file_name,
            'storage_bucket', a.storage_bucket, 'storage_path', a.storage_path,
            'mime_type', a.mime_type, 'file_size', a.file_size
          ) ORDER BY a.created_at), '[]'::json)
          FROM public.form_attachments a
          WHERE a.form_type = 'form_submissions' AND a.form_id = s.id
        )
      ) ORDER BY s.created_at DESC), '[]'::json)
      FROM public.form_submissions s
      JOIN public.form_templates t ON t.id = s.template_id
      LEFT JOIN public.employees e_app ON e_app.id = s.applicant_id
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = t.approval_chain_id AND cur_step.step_order = s.current_step
      LEFT JOIN public.request_chain_snapshots snap_step ON snap_step.request_type = 'form_submission' AND snap_step.request_id = s.id AND snap_step.step_order = s.current_step
      WHERE s.organization_id = emp.organization_id AND s.status = '申請中'
        AND s.deleted_at IS NULL  -- ★ soft-delete filter
        AND (
          (snap_step.id IS NOT NULL AND public._employee_matches_snapshot_step(emp.id, 'form_submission', s.id, s.current_step, s.applicant_id))
          OR (snap_step.id IS NULL AND t.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, s.applicant_id))
          OR public._has_pending_extra_for_me('form_submissions', s.id, emp.id)
        )
    ),
    'task_confirmations', '[]'::json,
    'shift_swaps_for_peer', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json) FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待對方同意'
        AND ss.deleted_at IS NULL  -- ★ soft-delete filter
        AND ss.target_id = emp.id AND ss.requester_id <> emp.id
    ),
    'shift_swaps_for_manager', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json) FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待主管核准'
        AND ss.deleted_at IS NULL  -- ★ soft-delete filter
        AND ss.requester_id <> emp.id AND ss.target_id <> emp.id
        AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
             OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(row_to_json(ofr.*) ORDER BY ofr.created_at DESC), '[]'::json) FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id AND ofr.status = '待審核'
        AND ofr.deleted_at IS NULL  -- ★ soft-delete filter
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(ofr.employee_id))
        AND COALESCE(ofr.employee_id, -1) <> emp.id
    ),
    'can', json_build_object(
      'hr', public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', (public.liff_employee_has_permission(emp.id, 'expense.approve') OR public.liff_employee_has_permission(emp.id, 'expense.settle'))
    )
  ) INTO result;
  RETURN result;
END
$function$;
