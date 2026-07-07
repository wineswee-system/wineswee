-- 修：#4 商品調撥核准缺「當前關卡審核者」驗證（授權洞）+ #7 matcher 缺 5 個調撥 target_type
-- 2026-07-07（goods_transfer 目前 0 筆，屬預防性修正）
-- #4：goods_transfer_approve 原本只擋狀態/action，不檢查按的人是不是這關該簽的人 →
--     任何知道單 id 的人可核准/推進/駁回。補上 resolve_snapshot_step_approvers 成員檢查
--     （listing RPC liff_list_transfer_approvals 有查、approve 漏了）。dump live 全文 + 插入 guard。
-- #7：_employee_matches_snapshot_step 缺 transfer_in/out_store_manager/supervisor + warehouse_supervisor
--     5 種分支（resolver 有、matcher 無）→ 任何走 matcher 的通用 RPC 碰到調撥就 stuck。
--     照 resolver 邏輯 incremental 補 IF（禁整支重寫語意，這裡是 dump live 全文 + 尾端加 3 個 IF）。
-- idempotent：CREATE OR REPLACE。

-- ══════════ #4 goods_transfer_approve（加授權 guard）══════════
CREATE OR REPLACE FUNCTION public.goods_transfer_approve(p_id integer, p_approver_id integer, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_record         goods_transfer_requests;
  v_stage          TEXT;
  v_request_type   TEXT;
  v_total_steps    INT;
  v_is_last        BOOLEAN;
  v_new_status     TEXT;
  v_extra          public.approval_extra_steps;
  v_entered_at     TIMESTAMPTZ;
  v_step_label     TEXT;
  v_approver_name  TEXT;
BEGIN
  SELECT * INTO v_record FROM goods_transfer_requests WHERE id = p_id;

  IF v_record.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_record.status NOT IN ('申請審核中', '驗收審核中') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_STATUS', 'current', v_record.status);
  END IF;
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  -- 加簽 guard
  v_extra := public.get_pending_extra_step(
    'goods_transfer_requests', p_id, COALESCE(v_record.current_step, 0)
  );
  IF v_extra.id IS NOT NULL THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'PENDING_EXTRA_SIGNER',
      'extra_step_id', v_extra.id,
      'extra_assignee_id', v_extra.assignee_id,
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
    );
  END IF;

  v_stage := v_record.current_stage;
  v_request_type := CASE v_stage WHEN 'apply' THEN 'goods_transfer_apply' ELSE 'goods_transfer_receipt' END;

  -- ★ 授權 guard（NEW）：只有這關該簽的人才能核准/推進/駁回
  IF NOT EXISTS (
    SELECT 1 FROM public.resolve_snapshot_step_approvers(
      v_request_type, p_id, v_record.current_step, v_record.applicant_id
    ) a WHERE a.emp_id = p_approver_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  -- lookup step_label（從 snapshot）
  SELECT label INTO v_step_label
    FROM request_chain_snapshots
   WHERE request_type = v_request_type
     AND request_id   = p_id
     AND step_order   = v_record.current_step;

  SELECT name INTO v_approver_name FROM employees WHERE id = p_approver_id;

  SELECT exited_at INTO v_entered_at
    FROM approval_step_history
   WHERE request_type = v_request_type
     AND request_id   = p_id
     AND step_order   = v_record.current_step - 1
   ORDER BY exited_at DESC NULLS LAST
   LIMIT 1;
  IF v_entered_at IS NULL THEN
    v_entered_at := CASE v_stage
      WHEN 'apply'   THEN v_record.created_at
      ELSE COALESCE(v_record.receipt_submitted_at, v_record.created_at)
    END;
  END IF;

  INSERT INTO approval_step_history (
    request_type, request_id, organization_id, chain_id, step_order,
    step_label, approver_id, approver_name, action,
    entered_at, exited_at, notes
  ) VALUES (
    v_request_type, p_id, v_record.organization_id, v_record.current_chain_id, v_record.current_step,
    v_step_label, p_approver_id, v_approver_name,
    CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
    v_entered_at, NOW(),
    CASE WHEN p_action = 'reject' THEN btrim(p_reason) ELSE NULL END
  );

  IF p_action = 'reject' THEN
    UPDATE goods_transfer_requests SET
      status = '已駁回',
      reject_reason = btrim(p_reason),
      rejected_at = NOW(),
      current_chain_id = NULL,
      current_step = 0,
      current_stage = NULL
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'action', 'rejected');
  END IF;

  SELECT COUNT(*) INTO v_total_steps
    FROM approval_chain_steps
   WHERE chain_id = v_record.current_chain_id;
  v_is_last := (v_record.current_step + 1 >= v_total_steps);

  IF v_is_last THEN
    IF v_stage = 'apply' THEN
      v_new_status := '待驗收';
      UPDATE goods_transfer_requests SET
        status = v_new_status,
        apply_approver_id = p_approver_id,
        apply_approved_at = NOW(),
        current_chain_id = NULL, current_step = 0, current_stage = NULL
      WHERE id = p_id;
    ELSE
      v_new_status := '已完成';
      UPDATE goods_transfer_requests SET
        status = v_new_status,
        receipt_approver_id = p_approver_id,
        receipt_approved_at = NOW(),
        current_chain_id = NULL, current_step = 0, current_stage = NULL
      WHERE id = p_id;
    END IF;
    RETURN json_build_object('ok', true, 'action', 'approved_final', 'new_status', v_new_status);
  ELSE
    UPDATE goods_transfer_requests SET current_step = current_step + 1 WHERE id = p_id;
    RETURN json_build_object('ok', true, 'action', 'advanced', 'next_step', v_record.current_step + 1);
  END IF;
END $function$;

-- ══════════ #7 _employee_matches_snapshot_step（尾端補 5 個調撥 target_type）══════════
CREATE OR REPLACE FUNCTION public._employee_matches_snapshot_step(p_emp_id integer, p_request_type text, p_request_id integer, p_step_order integer, p_applicant_emp_id integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
