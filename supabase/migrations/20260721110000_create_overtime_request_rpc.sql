-- 建立加班單 RPC(單一寫入路徑)— 2026-07-21
-- 決策:web/LIFF/手機建加班單一律走這支 RPC → 之後改規則只動一支,三邊自動同步。
-- overtime 在 workflowIntegration.DISABLED_TYPES → 簽核鏈/workflow/快照/通知全由 DB trigger
--   在 insert 時自動處理,前端 createApprovalWorkflow 對它是空操作。所以此 RPC 只需:
--   驗證 → 算淨工時(overtime_net_hours,與 trigger 同源)→ insert(時數 trg_a0 會再算一次,冪等)→ 回 row。
--   46h 月上限 / 時段重疊由既有 trigger/constraint 把關,不在此重複(單一來源)。
-- SECURITY DEFINER:繞 RLS 建單(簽核鏈自己控可見/推進),與現有前端「任何登入者可代建」行為一致。

CREATE OR REPLACE FUNCTION public.create_overtime_request(
  p_employee_id    int,
  p_date           date,
  p_start_time     time,
  p_end_time       time,
  p_ot_type        text    DEFAULT 'pay',
  p_reason         text    DEFAULT NULL,
  p_store          text    DEFAULT NULL,
  p_is_pre_approval boolean DEFAULT false
) RETURNS public.overtime_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_emp  public.employees;
  v_net  numeric;
  v_row  public.overtime_requests;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- 必填
  IF p_employee_id IS NULL OR p_date IS NULL OR p_start_time IS NULL OR p_end_time IS NULL THEN
    RAISE EXCEPTION '缺少必填欄位(員工/日期/起訖時間)';
  END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN RAISE EXCEPTION '查無此員工'; END IF;

  -- 淨工時(與 enforce trigger 同一支 overtime_net_hours,單一來源)
  v_net := public.overtime_net_hours(p_store, v_emp.organization_id, p_start_time, p_end_time);
  IF v_net IS NULL OR v_net <= 0 THEN
    RAISE EXCEPTION '加班時數計算為 0,請檢查起訖時間';
  END IF;
  IF v_net > 12 THEN
    RAISE EXCEPTION '單筆加班超過 12 小時上限(淨工時 % 小時),請確認起訖時間', v_net;
  END IF;

  -- insert(hours 先帶淨值;trg_a0_overtime_net_hours 會再算一次,結果相同=冪等)
  -- 其餘:approval_chain_id / 快照 / 分類 / 46h上限 / 通知 全由既有 trigger 處理
  INSERT INTO public.overtime_requests (
    employee_id, employee, date, start_time, end_time,
    ot_type, reason, store, status, organization_id, is_pre_approval, hours
  ) VALUES (
    v_emp.id, v_emp.name, p_date, p_start_time, p_end_time,
    COALESCE(p_ot_type, 'pay'), p_reason, p_store, '待審核',
    v_emp.organization_id, COALESCE(p_is_pre_approval, false), v_net
  ) RETURNING * INTO v_row;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.create_overtime_request(int, date, time, time, text, text, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
