-- ════════════════════════════════════════════════════════════════════════════
-- leave_step_settings.unit 加「minute」選項
-- 2026-07-02
--
-- 原 CHECK (unit IN ('day','hour'))。新增「分鐘」單位讓假別可設更細的最小單位
-- （如哺乳 30 分、家庭照顧 15 分）。倍數 step 前端改自由填數字。
-- 消費端（後台 hr/Leave.jsx、LIFF Leave.jsx）同步加 minute 進位換算。
-- step NUMERIC(4,2) 上限 99.99 夠用（分鐘 step 一般 ≤60）。
-- 冪等：DROP + ADD CONSTRAINT IF EXISTS。
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.leave_step_settings
  DROP CONSTRAINT IF EXISTS leave_step_settings_unit_check;

ALTER TABLE public.leave_step_settings
  ADD CONSTRAINT leave_step_settings_unit_check
  CHECK (unit IN ('day', 'hour', 'minute'));

NOTIFY pgrst, 'reload schema';
