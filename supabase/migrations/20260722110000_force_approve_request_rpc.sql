-- 表單查詢中心 階段3:強制通過 RPC — 2026-07-22
-- ════════════════════════════════════════════════════════════════════════════
-- 管理員強制核准卡住的表單(跳過簽核鏈;例:簽核人離職/卡太久)。
-- 設 status='已核准' → 觸發既有終審 cascade(離職→員工離職、加班→進計薪 gate 等,同正常核准)。
-- ★稽核★:限 admin/super_admin、★強制要填原因★、GUC 記簽核人給 ASH、另插一筆明確
--   「強制通過」ASH row(approver+原因)→ 勞資糾紛查得到誰強制、為何。
-- 欄位差異:HR A(leave/overtime/trip/correction)用 approved_by(文字);trip 無 approved_at。
--          HR B(resignation/loa/transfer/headcount)用 approver_id + approved_at。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.force_approve_request(
  p_type     text,
  p_id       integer,
  p_reason   text,
  p_actor_id integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller   employees;
  v_table    text;
  v_chain    int;
  v_cur      int;
  v_status   text;
  v_org      int;
  v_total    int;
BEGIN
  -- 呼叫者 + 權限(限 admin/super_admin)
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

  EXECUTE format('SELECT approval_chain_id, current_step, status, organization_id FROM %I WHERE id=$1', v_table)
    INTO v_chain, v_cur, v_status, v_org USING p_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_status = '已核准' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_APPROVED');
  END IF;

  SELECT COUNT(*) INTO v_total FROM approval_chain_steps WHERE chain_id = v_chain;

  -- 記簽核人給 ASH trigger(GUC)
  PERFORM set_config('app.ash_approver_id', v_caller.id::text, true);

  -- 設 status=已核准 + 推鏈到底 + 簽核人(欄位依類型)
  IF p_type = 'trip' THEN  -- trip 無 approved_at
    EXECUTE format('UPDATE %I SET status=$1, current_step=GREATEST(COALESCE(current_step,0),$2), approved_by=$3 WHERE id=$4', v_table)
      USING '已核准', v_total, v_caller.name, p_id;
  ELSIF p_type IN ('leave', 'overtime', 'correction') THEN
    EXECUTE format('UPDATE %I SET status=$1, current_step=GREATEST(COALESCE(current_step,0),$2), approved_by=$3, approved_at=NOW() WHERE id=$4', v_table)
      USING '已核准', v_total, v_caller.name, p_id;
  ELSE  -- HR B:approver_id + approved_at
    EXECUTE format('UPDATE %I SET status=$1, current_step=GREATEST(COALESCE(current_step,0),$2), approver_id=$3, approved_at=NOW() WHERE id=$4', v_table)
      USING '已核准', v_total, v_caller.id, p_id;
  END IF;

  -- 明確稽核:強制通過 row(不能無痕)
  INSERT INTO approval_step_history
    (request_type, request_id, organization_id, chain_id, step_order, step_label,
     entered_at, exited_at, duration_seconds, action, approver_id, approver_name, notes)
  VALUES
    (p_type, p_id, v_org, v_chain, COALESCE(v_cur, 0), '強制通過',
     NOW(), NOW(), 0, 'approved', v_caller.id, v_caller.name, '強制通過（管理員）：' || p_reason);

  RETURN jsonb_build_object('ok', true, 'status', '已核准', 'forced_by', v_caller.name);
END $function$;

GRANT EXECUTE ON FUNCTION public.force_approve_request(text, integer, text, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
