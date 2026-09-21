-- leave_requests.days: INT → NUMERIC
-- 2026-07-06
-- 問題：時數請假的 days 是小數（如 2 小時 = 0.3 天）。原欄位是 `int not null`（初始 schema），
--   小數 0.3 塞進 INT 會被 round 成 0 → 違反 chk_leave_positive_days (CHECK days > 0)
--   → LIFF 時數假送出報「violates check constraint chk_leave_positive_days」。
--   整天假(days=1,2..)不受影響，所以只有時數假中招。
-- 影響面：
--   - liff_insert_leave_request 早就 cast ::numeric、前端也傳小數 → 對齊
--   - payroll(_compute) 早用 v_leave_days NUMERIC(4,1) := SUM(days) 再 * 日薪 → 小數更正確
--   - 前端各處都是 reduce 加總 days → 小數無妨
--   既有整數值(1,2..)原樣保留，僅型別放寬。
-- idempotent：只有目前仍是整數型別時才 ALTER。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'leave_requests'
       AND column_name  = 'days'
       AND data_type IN ('integer', 'bigint', 'smallint')
  ) THEN
    ALTER TABLE public.leave_requests ALTER COLUMN days TYPE NUMERIC USING days::numeric;
  END IF;
END $$;
