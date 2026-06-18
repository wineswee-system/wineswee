-- ════════════════════════════════════════════════════════════════════════════
-- 提早下班登記表（店方安排早退）— early_leave_records
-- 2026-06-18
--
-- 情境：生意清淡/人力過剩，店長請員工提早下班。打卡會 < 班表 → 被當「早退」。
-- 不希望店長偷改班表，也不希望員工被當早退扣錢（是公司叫他走的，觀感差）。
-- 解法：店長記一筆「提早下班登記」（無簽核，純紀錄）。計薪那天就跳過早退扣款，
--       底薪本來就照實際打卡時數算 → 直接算對，班表不用動。
--
-- 欄位：員工 + 日期 + 早退起訖(early_from~early_to，例 15:00~17:00) + 原因。
-- 一人一天一筆（UNIQUE）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.early_leave_records (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id     INT  NOT NULL REFERENCES public.employees(id),
  date            DATE NOT NULL,
  store_id        INT  REFERENCES public.stores(id),
  early_from      TIME,                       -- 提早離開時間（例 15:00）
  early_to        TIME,                       -- 原班表該下班時間（例 17:00）
  reason          TEXT,                       -- 原因（生意清淡/人力過剩…）
  created_by      INT  REFERENCES public.employees(id),
  organization_id INT  REFERENCES public.organizations(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_early_leave_emp_date
  ON public.early_leave_records(employee_id, date);

ALTER TABLE public.early_leave_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS early_leave_read ON public.early_leave_records;
CREATE POLICY early_leave_read ON public.early_leave_records
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = current_employee_org());

DROP POLICY IF EXISTS early_leave_write ON public.early_leave_records;
CREATE POLICY early_leave_write ON public.early_leave_records
  FOR ALL TO authenticated
  USING (organization_id = current_employee_org())
  WITH CHECK (organization_id = current_employee_org());

COMMIT;

NOTIFY pgrst, 'reload schema';
