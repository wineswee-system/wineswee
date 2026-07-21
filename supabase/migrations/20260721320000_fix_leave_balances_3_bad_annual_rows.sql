-- 修 leave_balances 3 筆特休錯資料(104 匯入殘漏)— 2026-07-21 [收斂階段4]
-- 大檢查抓到的 3 筆與 §38 對不上(其餘 104 匯入值正確)。以 employee_id+year+leave_type 定位,idempotent。
--
--   張耀(id119,到職2026-01-05,正職):first-year 應 3天、period 滿6月起(對齊呂柏毅/孫嘉澤同儕慣例)
--        原 total=7、period=2026-12-07(亂) → 改 3天、2026-07-05~2027-01-04
--   陳佩璇(id71,到職2025-05-26,正職):滿1年應 7天,原 7.6875(怪值) → 7
--   楊學文(id69,到職2025-04-14,已離職):滿1年應 7天,原 10(多給) → 7(影響折現)

UPDATE public.leave_balances
   SET total_days = 3, period_start = '2026-07-05', expires_at = '2027-01-04'
 WHERE employee_id = 119 AND year = 2026 AND leave_type = 'annual'
   AND (total_days <> 3 OR period_start <> '2026-07-05');

UPDATE public.leave_balances
   SET total_days = 7
 WHERE employee_id = 71 AND year = 2026 AND leave_type = 'annual' AND total_days <> 7;

UPDATE public.leave_balances
   SET total_days = 7
 WHERE employee_id = 69 AND year = 2026 AND leave_type = 'annual' AND total_days <> 7;

NOTIFY pgrst, 'reload schema';
