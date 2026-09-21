-- LIFF 薪資單「逐假別+日期」顯示需要 end_date:計薪引擎 _leave_rows 明細加 end_date(算連續請假範圍用)。
-- 純加輸出欄位,不動任何金額。idempotent(只在還沒加時替換)。
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc WHERE proname = '_compute_payroll_for_employee';
  IF v_def IS NOT NULL AND position('''end_date'', end_date' in v_def) = 0 THEN
    v_def := replace(
      v_def,
      'jsonb_build_object(''date'', start_date, ''type'', type, ''hours'',',
      'jsonb_build_object(''date'', start_date, ''end_date'', end_date, ''type'', type, ''hours'','
    );
    EXECUTE v_def;
  END IF;
END $$;
