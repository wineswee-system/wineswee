-- ============================================================
--  Employee Assignments (time-sliced dept/store/position history)
--
--  Models the effective-dated multi-assignment data shape:
--    one employee can have multiple concurrent or sequential
--    rows with start_date / end_date / is_active / 主要-次要.
--
--  Also adds master-only fields to employees:
--    job_grade (職等), updated_by (修改人).
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Master fields on employees
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS job_grade  TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS updated_by INT
  REFERENCES public.employees(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────
-- 2. Assignment history table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_assignments (
  id               SERIAL PRIMARY KEY,
  employee_id      INT NOT NULL REFERENCES public.employees(id)   ON DELETE CASCADE,
  department_id    INT REFERENCES public.departments(id)          ON DELETE SET NULL,
  store_id         INT REFERENCES public.stores(id)               ON DELETE SET NULL,
  position         TEXT,
  job_grade        TEXT,
  employment_type  TEXT,                          -- 全職 / 兼職 / 其他
  department_type  TEXT NOT NULL DEFAULT '主要',   -- 主要 / 次要
  is_part_time     BOOLEAN NOT NULL DEFAULT false,
  avg_weekly_hours INT NOT NULL DEFAULT 0,
  start_date       DATE NOT NULL,
  end_date         DATE,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  updated_by       INT REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT employee_assignments_date_order_ck
    CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT employee_assignments_dept_type_ck
    CHECK (department_type IN ('主要','次要'))
);

CREATE INDEX IF NOT EXISTS idx_ea_employee        ON public.employee_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_ea_department      ON public.employee_assignments(department_id);
CREATE INDEX IF NOT EXISTS idx_ea_store           ON public.employee_assignments(store_id);
CREATE INDEX IF NOT EXISTS idx_ea_active          ON public.employee_assignments(employee_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_ea_effective_range ON public.employee_assignments(start_date, end_date);

-- Only one 主要 active assignment per employee. 次要 can have many.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ea_primary_active
  ON public.employee_assignments(employee_id)
  WHERE department_type = '主要' AND is_active = true;

COMMENT ON TABLE public.employee_assignments IS
  'Effective-dated history of employee ↔ department/store/position. Supports 主要/次要 concurrent assignments.';

-- ────────────────────────────────────────────────────────────
-- 3. Auto-maintain is_active based on end_date
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_ea_auto_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only auto-set when the caller did not explicitly set is_active.
  -- Rule: active = end_date IS NULL OR end_date >= today.
  IF TG_OP = 'INSERT' THEN
    NEW.is_active := (NEW.end_date IS NULL OR NEW.end_date >= CURRENT_DATE);
  ELSIF TG_OP = 'UPDATE' AND NEW.end_date IS DISTINCT FROM OLD.end_date THEN
    NEW.is_active := (NEW.end_date IS NULL OR NEW.end_date >= CURRENT_DATE);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ea_auto_active ON public.employee_assignments;
CREATE TRIGGER trg_ea_auto_active
  BEFORE INSERT OR UPDATE ON public.employee_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_ea_auto_active();

-- ────────────────────────────────────────────────────────────
-- 4. Backfill: one 主要 assignment per existing employee from
--    their current master-row state.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.employee_assignments (
  employee_id, department_id, store_id, position,
  employment_type, department_type, start_date, end_date, is_active
)
SELECT
  e.id,
  e.department_id,
  e.store_id,
  e.position,
  COALESCE(e.employment_type, '全職'),
  '主要',
  -- Guarantee start_date <= end_date even when join_date is missing or
  -- after resign_date (dirty legacy data): fall back to the earliest
  -- known date.
  COALESCE(e.join_date, e.resign_date, CURRENT_DATE),
  e.resign_date,
  (e.status = '在職')
FROM public.employees e
WHERE NOT EXISTS (
  SELECT 1 FROM public.employee_assignments ea
  WHERE ea.employee_id = e.id AND ea.department_type = '主要'
);

-- ────────────────────────────────────────────────────────────
-- 5. Current-state convenience view (joins master + active 主要)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_employees_current AS
SELECT
  e.*,
  ea.id               AS assignment_id,
  ea.department_type  AS current_department_type,
  ea.is_part_time     AS current_is_part_time,
  ea.avg_weekly_hours AS current_avg_weekly_hours,
  ea.start_date       AS current_start_date,
  ea.end_date         AS current_end_date,
  ea.job_grade        AS current_job_grade,
  d.name              AS current_department_name,
  s.name              AS current_store_name
FROM public.employees e
LEFT JOIN public.employee_assignments ea
  ON ea.employee_id = e.id
 AND ea.department_type = '主要'
 AND ea.is_active = true
LEFT JOIN public.departments d ON d.id = ea.department_id
LEFT JOIN public.stores      s ON s.id = ea.store_id;

-- ────────────────────────────────────────────────────────────
-- 6. RLS — follow the same pattern as employee_line_accounts
--    (auth-readable, mutations gated by the parent employees RLS).
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.employee_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ea_read        ON public.employee_assignments;
DROP POLICY IF EXISTS ea_write_admin ON public.employee_assignments;

CREATE POLICY ea_read
  ON public.employee_assignments
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY ea_write_admin
  ON public.employee_assignments
  FOR ALL TO authenticated
  USING (public.current_employee_role() IN ('admin','super_admin','manager'))
  WITH CHECK (public.current_employee_role() IN ('admin','super_admin','manager'));

COMMIT;
