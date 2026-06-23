-- ════════════════════════════════════════════════════════════════════════════
-- 費用申請幣別新增 NZD(紐西蘭幣) / AUD(澳幣)
-- 2026-06-23
-- expense_requests.currency 的 CHECK 放寬,加入 NZD、AUD。
-- 最新版 liff_insert_expense_request(20260524090000)已無獨立 guard,靠此 CHECK 把關。
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.expense_requests
  DROP CONSTRAINT IF EXISTS chk_expense_request_currency;
ALTER TABLE public.expense_requests
  ADD CONSTRAINT chk_expense_request_currency
    CHECK (currency IN ('TWD', 'USD', 'JPY', 'CNY', 'EUR', 'NZD', 'AUD'));

NOTIFY pgrst, 'reload schema';
