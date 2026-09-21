-- 修 trip #8:補 employee_id + 轉至正確簽核鏈(#31 主管鏈) — 2026-07-21
-- ════════════════════════════════════════════════════════════════════════════
-- trip #8(張庭瑋出差)因 liff_upsert_business_trip 漏帶 employee_id(已於 20260721230000 修根因)
--   → employee_id=NULL → 隱形 + 被誤分到 #32 行政鏈(應走 #31 主管鏈)。
-- 此檔修「這一張既有壞單」:補 emp=62、轉 #31、重建快照與 ASH。
--   #31 對張庭瑋解出 step0 執行長陳虹(52)、step1 人資張啟達 → 有效、非自簽。
-- guard:只在 trip #8 仍為壞狀態(emp NULL 且申請人=張庭瑋)時處理,可重複跑。
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_emp   int;
  v_name  text;
  v_org   int;
  v_status text;
BEGIN
  SELECT employee_id, employee, organization_id, status
    INTO v_emp, v_name, v_org, v_status
    FROM public.business_trips WHERE id = 8;

  IF NOT FOUND THEN
    RAISE NOTICE '[trip8] 不存在,跳過'; RETURN;
  END IF;
  IF v_emp IS NOT NULL THEN
    RAISE NOTICE '[trip8] 已修(employee_id=%),跳過', v_emp; RETURN;
  END IF;
  IF v_name IS DISTINCT FROM '張庭瑋' THEN
    RAISE NOTICE '[trip8] 申請人非張庭瑋(=%),為安全跳過,請人工確認', v_name; RETURN;
  END IF;
  IF v_status NOT IN ('待審核','申請中','待審','簽核中') THEN
    RAISE NOTICE '[trip8] 非在飛狀態(=%),跳過', v_status; RETURN;
  END IF;

  -- 抑制 LINE(此為資料修復,非真正新單)
  PERFORM set_config('app.skip_chain_notify', 'true', true);

  -- 1) 補 emp + 轉 #31 主管鏈(current_step 回 0)
  UPDATE public.business_trips
     SET employee_id = 62, approval_chain_id = 31, current_step = 0
   WHERE id = 8;

  -- 2) 重建快照(舊的是 #32 的)— 傳 applicant 62 以凍結正確簽核人
  DELETE FROM public.request_chain_snapshots WHERE request_type = 'trip' AND request_id = 8;
  PERFORM public._snapshot_chain_for_request('trip', 8, 31, 62);

  -- 3) 重建 ASH(舊的 entered row 指向 #32/舊 step,清掉補一筆 #31 step0 submitted)
  DELETE FROM public.approval_step_history WHERE request_type = 'trip' AND request_id = 8;
  INSERT INTO public.approval_step_history
    (request_type, request_id, organization_id, chain_id, step_order, step_label, target_type, entered_at, action)
  SELECT 'trip', 8, COALESCE(v_org, 1), 31, 0, label, target_type, NOW(), 'submitted'
    FROM public.approval_chain_steps WHERE chain_id = 31 AND step_order = 0;

  RAISE NOTICE '[trip8] ✅ 已轉至 #31 主管鏈(step0 執行長陳虹 → step1 人資張啟達),現在會顯示在簽核中心待簽';
END $$;

NOTIFY pgrst, 'reload schema';
