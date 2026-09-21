-- ============================================================
-- Fix: 補 expenses / business_trips / clock_corrections 的
--      employee_id + organization_id 欄位
--
-- 症狀：使用者按「儲存」新增報銷申請（或出差/補打卡）→ POST 回 400
--   {"code":"42703","message":"record \"new\" has no field \"employee_id\""}
--
-- 根因：5 張 HR 表共用 BEFORE INSERT trigger trg_hr_auto_approve_owner（在
--   20260426010000_approval_system_redesign.sql 建立），function 內部讀
--   NEW.employee_id 與 NEW.organization_id。leave_requests / overtime_requests
--   早在 20260416100006_schema_gap_closure.sql 補了這兩欄，但 expenses /
--   business_trips / clock_corrections 一直沒補 → trigger 跑到第一行就
--   42703 → 任何新申請都失敗。
--
-- 修：把缺的欄位補上 + backfill（從 employee name 反查 id / org），保留
--   employee TEXT 欄位以維持向下相容。Frontend 之後可選擇直接送 employee_id
--   讓 trigger 不必走 name 反查（更穩，但非必要）。
-- ============================================================

BEGIN;

-- ── 1. expenses ─────────────────────────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS employee_id     INT REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;

UPDATE public.expenses e
SET    employee_id     = emp.id,
       organization_id = emp.organization_id
FROM   public.employees emp
WHERE  e.employee     = emp.name
  AND  e.employee_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_employee_id ON public.expenses(employee_id);
CREATE INDEX IF NOT EXISTS idx_expenses_organization_id ON public.expenses(organization_id);


-- ── 2. business_trips ───────────────────────────────────────
ALTER TABLE public.business_trips
  ADD COLUMN IF NOT EXISTS employee_id     INT REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;

UPDATE public.business_trips t
SET    employee_id     = emp.id,
       organization_id = emp.organization_id
FROM   public.employees emp
WHERE  t.employee     = emp.name
  AND  t.employee_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_business_trips_employee_id ON public.business_trips(employee_id);
CREATE INDEX IF NOT EXISTS idx_business_trips_organization_id ON public.business_trips(organization_id);


-- ── 3. clock_corrections ────────────────────────────────────
ALTER TABLE public.clock_corrections
  ADD COLUMN IF NOT EXISTS employee_id     INT REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;

UPDATE public.clock_corrections c
SET    employee_id     = emp.id,
       organization_id = emp.organization_id
FROM   public.employees emp
WHERE  c.employee     = emp.name
  AND  c.employee_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_clock_corrections_employee_id ON public.clock_corrections(employee_id);
CREATE INDEX IF NOT EXISTS idx_clock_corrections_organization_id ON public.clock_corrections(organization_id);


NOTIFY pgrst, 'reload schema';

COMMIT;
