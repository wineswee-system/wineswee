-- ============================================================
-- Phase 7: Close remaining schema gaps vs wines
-- Adds missing store + employee columns identified in comparison
-- ============================================================

-- ─── Stores: clock-in policy + variable working hours ───

ALTER TABLE stores ADD COLUMN IF NOT EXISTS clock_in_method TEXT DEFAULT 'any';
  -- 'any' = GPS or WiFi, 'gps_required' = GPS only, 'gps_or_wifi' = either

ALTER TABLE stores ADD COLUMN IF NOT EXISTS working_hour_type TEXT DEFAULT 'standard';
  -- 'standard' = 固定工時, 'variable' = 變形工時 (2週/4週/8週)

ALTER TABLE stores ADD COLUMN IF NOT EXISTS variable_period_start DATE;
  -- 變形工時起算日

ALTER TABLE stores ADD COLUMN IF NOT EXISTS default_labor_budget NUMERIC(12,2);
  -- 每月預設人力預算

ALTER TABLE stores ADD COLUMN IF NOT EXISTS hourly_rate_default NUMERIC(8,2);
  -- 門市預設時薪（兼職適用）

-- ─── Employees: soft delete + missing fields ───

ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

-- ─── Cross-module FK columns (employee_id, store_id on HR tables) ───

-- attendance_records
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS employee_id INT REFERENCES employees(id);
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS store_id INT REFERENCES stores(id);

-- leave_requests
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS employee_id INT REFERENCES employees(id);

-- overtime_requests
ALTER TABLE overtime_requests ADD COLUMN IF NOT EXISTS employee_id INT REFERENCES employees(id);

-- salary_records
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS employee_id INT REFERENCES employees(id);

-- off_requests (scheduling)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'off_requests') THEN
    EXECUTE 'ALTER TABLE off_requests ADD COLUMN IF NOT EXISTS employee_id INT REFERENCES employees(id)';
  END IF;
END $$;

-- schedules
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schedules') THEN
    EXECUTE 'ALTER TABLE schedules ADD COLUMN IF NOT EXISTS employee_id INT REFERENCES employees(id)';
  END IF;
END $$;

-- tasks (assignee FK)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_id INT REFERENCES employees(id);

-- punch_corrections
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'punch_corrections') THEN
    EXECUTE 'ALTER TABLE punch_corrections ADD COLUMN IF NOT EXISTS employee_id INT REFERENCES employees(id)';
  END IF;
END $$;

-- ─── Backfill employee_id on HR tables ───

UPDATE attendance_records ar SET employee_id = e.id
FROM employees e WHERE ar.employee = e.name AND ar.employee_id IS NULL;

UPDATE leave_requests lr SET employee_id = e.id
FROM employees e WHERE lr.employee = e.name AND lr.employee_id IS NULL;

UPDATE overtime_requests ot SET employee_id = e.id
FROM employees e WHERE ot.employee = e.name AND ot.employee_id IS NULL;

UPDATE salary_records sr SET employee_id = e.id
FROM employees e WHERE sr.employee = e.name AND sr.employee_id IS NULL;

UPDATE tasks t SET assignee_id = e.id
FROM employees e WHERE t.assignee = e.name AND t.assignee_id IS NULL;

-- ─── Indexes ───

CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_employee_id ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_overtime_employee_id ON overtime_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_employee_id ON salary_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id);

-- ─── Sync triggers for HR tables ───

CREATE OR REPLACE FUNCTION sync_hr_employee_fk()
RETURNS TRIGGER AS $$
BEGIN
  -- FK → TEXT
  IF NEW.employee_id IS NOT NULL AND NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    SELECT name INTO NEW.employee FROM employees WHERE id = NEW.employee_id;
  END IF;
  -- TEXT → FK
  IF NEW.employee IS NOT NULL AND NEW.employee IS DISTINCT FROM OLD.employee AND NEW.employee_id IS NULL THEN
    SELECT id INTO NEW.employee_id FROM employees WHERE name = NEW.employee LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_records', 'leave_requests', 'overtime_requests', 'salary_records'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_hr_emp_%I ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_sync_hr_emp_%I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION sync_hr_employee_fk()', t, t);
  END LOOP;
END $$;

-- Task assignee sync
CREATE OR REPLACE FUNCTION sync_task_assignee_fk()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    SELECT name INTO NEW.assignee FROM employees WHERE id = NEW.assignee_id;
  END IF;
  IF NEW.assignee IS NOT NULL AND NEW.assignee IS DISTINCT FROM OLD.assignee AND NEW.assignee_id IS NULL THEN
    SELECT id INTO NEW.assignee_id FROM employees WHERE name = NEW.assignee LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_task_assignee ON tasks;
CREATE TRIGGER trg_sync_task_assignee
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION sync_task_assignee_fk();
