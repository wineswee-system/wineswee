-- ============================================================
-- Schema 對齊：補遺漏欄位 + 建遺漏表
-- 2026-04-18
-- ============================================================

BEGIN;

-- ═══ 1. overtime_requests 補欄位 ═══
ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS employee_id    INT REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS ot_type        TEXT DEFAULT 'pay',
  ADD COLUMN IF NOT EXISTS filing_type    TEXT DEFAULT 'pre',
  ADD COLUMN IF NOT EXISTS approved_by    INT REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS approved_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Backfill employee_id from employee name
UPDATE overtime_requests o SET employee_id = e.id
FROM employees e WHERE o.employee = e.name AND o.employee_id IS NULL;

-- ═══ 2. leave_requests 補 employee_id ═══
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS employee_id    INT REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS approved_by    INT REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS approved_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Backfill employee_id from employee name
UPDATE leave_requests l SET employee_id = e.id
FROM employees e WHERE l.employee = e.name AND l.employee_id IS NULL;

-- ═══ 3. employees 確認 line_user_id 欄位 ═══
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS line_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_employees_line_user_id
  ON public.employees(line_user_id) WHERE line_user_id IS NOT NULL;

-- ═══ 4. workflow_instance_line_group_assignments 表 ═══
CREATE TABLE IF NOT EXISTS public.workflow_instance_line_group_assignments (
  id                    SERIAL PRIMARY KEY,
  workflow_instance_id  INT NOT NULL,
  line_group_id         TEXT NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workflow_instance_id, line_group_id)
);

ALTER TABLE public.workflow_instance_line_group_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_wf_line_groups" ON public.workflow_instance_line_group_assignments
  FOR ALL USING (true) WITH CHECK (true);

-- ═══ 5. locations GPS 欄位名對齊 ═══
-- 前端 Locations.jsx 用 lat/lng/clock_radius，DB migration 用 gps_lat/gps_lng/gps_radius_m
-- 加 alias 讓兩邊都能用
DO $$
BEGIN
  -- 如果已有 lat 欄位（舊的），把資料搬到 gps_lat
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'locations' AND column_name = 'lat') THEN
    UPDATE locations SET gps_lat = lat::numeric(9,6) WHERE gps_lat IS NULL AND lat IS NOT NULL;
    UPDATE locations SET gps_lng = lng::numeric(9,6) WHERE gps_lng IS NULL AND lng IS NOT NULL;
    UPDATE locations SET gps_radius_m = clock_radius WHERE gps_radius_m IS NULL AND clock_radius IS NOT NULL;
  END IF;
END $$;

-- ═══ 6. attendance_records 補索引 ═══
CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON public.attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance_records(date);

-- ═══ 7. leave_requests / overtime_requests 補索引 ═══
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON public.leave_requests(employee);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_id ON public.leave_requests(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_overtime_requests_employee ON public.overtime_requests(employee);
CREATE INDEX IF NOT EXISTS idx_overtime_requests_employee_id ON public.overtime_requests(employee_id) WHERE employee_id IS NOT NULL;

COMMIT;
