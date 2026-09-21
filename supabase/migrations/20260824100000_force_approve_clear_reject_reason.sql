-- 強制通過守門:核准時清掉舊的 reject_reason(避免「已駁回原因 + 已核准」矛盾畫面);
-- 若該單原本是「已駁回」,在稽核 approval_step_history 備註標記「原已退回：<原因>」留痕。
-- 只動 force_approve_request,邏輯其餘不變。8 張表都有 reject_reason 欄。
CREATE OR REPLACE FUNCTION public.force_approve_request(p_type text, p_id integer, p_reason text, p_actor_id integer DEFAULT NULL::integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller     employees;
  v_table      text;
  v_chain      int;
  v_cur        int;
  v_status     text;
  v_org        int;
  v_total      int;
  v_prev_rej   text;
  v_note       text;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL AND p_actor_id IS NOT NULL THEN
    SELECT * INTO v_caller FROM employees WHERE id = p_actor_id;
  END IF;
  IF v_caller.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CALLER_NOT_FOUND');
  END IF;
  IF v_caller.role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ALLOWED');
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  v_table := CASE p_type
    WHEN 'leave'       THEN 'leave_requests'
    WHEN 'overtime'    THEN 'overtime_requests'
    WHEN 'trip'        THEN 'business_trips'
    WHEN 'correction'  THEN 'clock_corrections'
    WHEN 'resignation' THEN 'resignation_requests'
    WHEN 'loa'         THEN 'leave_of_absence_requests'
    WHEN 'transfer'    THEN 'personnel_transfer_requests'
    WHEN 'headcount'   THEN 'headcount_requests'
    ELSE NULL END;
  IF v_table IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE');
  END IF;

  EXECUTE format('SELECT approval_chain_id, current_step, status, organization_id, reject_reason FROM %I WHERE id=$1', v_table)
    INTO v_chain, v_cur, v_status, v_org, v_prev_rej USING p_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_status = '已核准' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_APPROVED');
  END IF;

  SELECT COUNT(*) INTO v_total FROM approval_chain_steps WHERE chain_id = v_chain;

  -- 稽核備註:原本被退回就標記留痕
  v_note := '強制通過（管理員）：' || p_reason;
  IF v_status = '已駁回' OR COALESCE(btrim(v_prev_rej), '') <> '' THEN
    v_note := v_note || '｜⚠原已退回：' || COALESCE(NULLIF(btrim(v_prev_rej), ''), v_status);
  END IF;

  PERFORM set_config('app.ash_approver_id', v_caller.id::text, true);

  -- 設 status=已核准 + 推鏈到底 + 簽核人 + 清掉舊退回原因(欄位依類型)
  IF p_type = 'trip' THEN
    EXECUTE format('UPDATE %I SET status=$1, current_step=GREATEST(COALESCE(current_step,0),$2), approved_by=$3, reject_reason=NULL WHERE id=$4', v_table)
      USING '已核准', v_total, v_caller.name, p_id;
  ELSIF p_type IN ('leave', 'overtime', 'correction') THEN
    EXECUTE format('UPDATE %I SET status=$1, current_step=GREATEST(COALESCE(current_step,0),$2), approved_by=$3, approved_at=NOW(), reject_reason=NULL WHERE id=$4', v_table)
      USING '已核准', v_total, v_caller.name, p_id;
  ELSE
    EXECUTE format('UPDATE %I SET status=$1, current_step=GREATEST(COALESCE(current_step,0),$2), approver_id=$3, approved_at=NOW(), reject_reason=NULL WHERE id=$4', v_table)
      USING '已核准', v_total, v_caller.id, p_id;
  END IF;

  INSERT INTO approval_step_history
    (request_type, request_id, organization_id, chain_id, step_order, step_label,
     entered_at, exited_at, action, approver_id, approver_name, notes)
  VALUES
    (p_type, p_id, v_org, v_chain, COALESCE(v_cur, 0), '強制通過',
     NOW(), NOW(), 'approved', v_caller.id, v_caller.name, v_note);

  RETURN jsonb_build_object('ok', true, 'status', '已核准', 'forced_by', v_caller.name,
    'was_rejected', (v_status = '已駁回' OR COALESCE(btrim(v_prev_rej),'') <> ''));
END $function$;
