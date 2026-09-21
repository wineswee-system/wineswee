-- 治本:假勤額度改由單一 trigger 維護(所有核准路徑一致);移除 secure_update/force_approve 的 inline 扣除避免雙扣。
-- 補休走 comp ledger 既有 trigger 不在此。歷史已核准假的 used_days 對帳另行處理(匯入歷史與漏扣混同一欄,不盲補)。

CREATE OR REPLACE FUNCTION public.secure_update_leave_status(p_id integer, p_status text, p_approver text, p_reject_reason text DEFAULT NULL::text)
 RETURNS leave_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tid     INT;
  v_current leave_requests;
  v_result  leave_requests;
  v_year    INT;
  v_used_delta NUMERIC;
  v_lb_type TEXT;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  SELECT * INTO v_current FROM leave_requests WHERE id = p_id AND organization_id = v_tid;
  IF NOT FOUND THEN RAISE EXCEPTION '假單不存在或無權限：%', p_id; END IF;

  IF v_current.status <> '待審核' THEN
    RAISE EXCEPTION '此假單已為「%」狀態，不可再變更', v_current.status;
  END IF;
  IF p_status NOT IN ('已核准', '已駁回', '已拒絕') THEN
    RAISE EXCEPTION '狀態只可為「已核准」/「已駁回」/「已拒絕」';
  END IF;
  IF p_status IN ('已駁回', '已拒絕') AND (p_reject_reason IS NULL OR p_reject_reason = '') THEN
    RAISE EXCEPTION '駁回時必須填寫原因';
  END IF;

  UPDATE leave_requests SET
    status        = p_status,
    approver      = p_approver,
    reject_reason = CASE WHEN p_status IN ('已駁回', '已拒絕') THEN p_reject_reason ELSE NULL END
  WHERE id = p_id
  RETURNING * INTO v_result;

  -- 扣額度改由 trigger trg_leave_sync_balance 統一處理(所有核准路徑一致,見 20260908140000)
  RETURN v_result;
END $function$


CREATE OR REPLACE FUNCTION public.force_approve_request(p_type text, p_id integer, p_reason text, p_actor_id integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
END $function$


-- 假勤額度改由單一 trigger 維護:任何路徑(網頁/LIFF/簽核鏈/強制通過)核准→扣、退回/取消/撤回→退。
-- 移除 secure_update_leave_status / force_approve_request 的 inline 扣除(見同批),避免雙扣/漏扣。
-- 補休(type=補休)不在此:走 comp_time_ledger 的既有 trigger。扣量=時數/8(全天假抓班表);8h班=1天、10h班=1.25天。
CREATE OR REPLACE FUNCTION public._trg_leave_sync_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_delta numeric; v_year int; v_code text; v_now boolean; v_was boolean;
BEGIN
  IF NEW.employee_id IS NULL OR NEW.type = '補休' THEN RETURN NEW; END IF;
  v_now := (NEW.status = '已核准');
  v_was := (TG_OP = 'UPDATE' AND OLD.status = '已核准');
  IF v_now = v_was THEN RETURN NEW; END IF;                 -- 核准狀態沒變 → 不動額度
  v_delta := CASE WHEN NEW.hours IS NOT NULL AND NEW.hours > 0 THEN NEW.hours/8.0 ELSE COALESCE(NEW.days,0) END;
  IF COALESCE(v_delta,0) = 0 THEN RETURN NEW; END IF;
  v_year := EXTRACT(YEAR FROM NEW.start_date)::int;
  v_code := CASE NEW.type
    WHEN '特休' THEN 'annual' WHEN '病假' THEN 'sick' WHEN '事假' THEN 'personal'
    WHEN '婚假' THEN 'marriage' WHEN '喪假' THEN 'bereavement' WHEN '產假' THEN 'maternity'
    WHEN '陪產假' THEN 'paternity' WHEN '生理假' THEN 'menstrual' WHEN '家庭照顧假' THEN 'family'
    WHEN '公假' THEN 'official' WHEN '公傷假' THEN 'injury' ELSE NEW.type END;

  IF v_now AND NOT v_was THEN            -- 核准 → 扣
    UPDATE leave_balances SET used_days = COALESCE(used_days,0)+v_delta, updated_at=now()
      WHERE employee_id=NEW.employee_id AND year=v_year AND leave_type=NEW.type;
    IF NOT FOUND THEN
      UPDATE leave_balances SET used_days = COALESCE(used_days,0)+v_delta, updated_at=now()
        WHERE employee_id=NEW.employee_id AND year=v_year AND leave_type=v_code;
    END IF;
  ELSE                                    -- 已核准 → 非核准(退回/取消/撤回) → 退
    UPDATE leave_balances SET used_days = GREATEST(0, COALESCE(used_days,0)-v_delta), updated_at=now()
      WHERE employee_id=NEW.employee_id AND year=v_year AND leave_type=NEW.type;
    IF NOT FOUND THEN
      UPDATE leave_balances SET used_days = GREATEST(0, COALESCE(used_days,0)-v_delta), updated_at=now()
        WHERE employee_id=NEW.employee_id AND year=v_year AND leave_type=v_code;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_leave_sync_balance ON public.leave_requests;
CREATE TRIGGER trg_leave_sync_balance
  AFTER INSERT OR UPDATE OF status ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_leave_sync_balance();

