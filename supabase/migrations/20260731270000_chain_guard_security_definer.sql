-- 簽核鏈 guard 加 SECURITY DEFINER — 2026-07-31
-- ════════════════════════════════════════════════════════════════════════════
-- 20260731260000 的 guard 新增「查 request_chain_snapshots 判斷有無快照」,但函式是
-- SECURITY INVOKER → 快照查詢吃「編輯者的 RLS」。一般用戶對 request_chain_snapshots
-- 沒 SELECT 權 → 看不到快照 → NOT EXISTS 誤判 true → 明明有快照的在飛單被當成「未建快照」
-- 而誤擋(慘案:Chain 31 leave #245 有快照,用戶存檔仍被擋;service_role 繞 RLS 則放行)。
-- 修:改 SECURITY DEFINER,guard 內所有檢查繞 RLS(只看 approval_chain_id=本鏈,不跨租戶)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._guard_chain_steps_in_flight()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count  INT;
  v_tables TEXT[] := ARRAY[
    'expense_requests', 'leave_requests', 'overtime_requests',
    'business_trips', 'clock_corrections', 'resignation_requests',
    'leave_of_absence_requests', 'personnel_transfer_requests', 'headcount_requests'
  ];
  v_rts    TEXT[] := ARRAY[
    'expense_request', 'leave_request', 'overtime_request',
    'trip', 'correction', 'resignation',
    'loa', 'transfer', 'headcount'
  ];
  v_table TEXT;
  v_rt    TEXT;
  i INT;
BEGIN
  IF current_setting('chain.bypass_guard', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- 只擋「沒建快照(改鏈真的會影響)」的在飛單;有快照的已凍結流程 → 放行
  FOR i IN 1 .. array_length(v_tables, 1) LOOP
    v_table := v_tables[i];
    v_rt    := v_rts[i];
    EXECUTE format(
      'SELECT COUNT(*) FROM public.%I t
        WHERE t.approval_chain_id = $1
          AND t.status IN (''申請中'',''待審'',''待審核'')
          AND NOT EXISTS (
            SELECT 1 FROM public.request_chain_snapshots s
             WHERE s.request_type = $2 AND s.request_id = t.id)',
      v_table
    ) USING OLD.chain_id, v_rt INTO v_count;
    IF v_count > 0 THEN
      RAISE EXCEPTION
        'Chain % 有 % 張「未建快照」的在飛單（表：%），改鏈會影響到這些單,請先讓它們完成或手動處理',
        OLD.chain_id, v_count, v_table
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_count
    FROM public.form_submissions fs
    JOIN public.form_templates ft ON ft.id = fs.template_id
   WHERE ft.approval_chain_id = OLD.chain_id
     AND fs.status IN ('申請中','待審','待審核','pending')
     AND NOT EXISTS (
       SELECT 1 FROM public.request_chain_snapshots s
        WHERE s.request_type = 'form_submission' AND s.request_id = fs.id);
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Chain % 有 % 張未建快照的在飛 form_submissions，請先處理',
      OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $function$;

NOTIFY pgrst, 'reload schema';
