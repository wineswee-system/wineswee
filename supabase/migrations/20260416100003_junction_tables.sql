-- ============================================================
-- Phase 3: Junction Tables — user_stores + department_manager_history
-- Purpose: Multi-store employee assignment + manager audit trail
-- ============================================================

-- ─── 3a. user_stores — multi-store assignment ───

CREATE TABLE IF NOT EXISTS user_stores (
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (employee_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_user_stores_employee ON user_stores(employee_id);
CREATE INDEX IF NOT EXISTS idx_user_stores_store ON user_stores(store_id);

-- Backfill from employees.store_id (primary store)
INSERT INTO user_stores (employee_id, store_id, is_primary)
SELECT id, store_id, true
FROM employees
WHERE store_id IS NOT NULL
ON CONFLICT (employee_id, store_id) DO NOTHING;

-- Backfill from employees.additional_stores TEXT[] (if column exists)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'additional_stores'
  ) THEN
    EXECUTE '
      INSERT INTO user_stores (employee_id, store_id, is_primary)
      SELECT e.id, s.id, false
      FROM employees e, unnest(e.additional_stores) AS store_name
      JOIN stores s ON s.name = store_name
      WHERE e.additional_stores IS NOT NULL
        AND array_length(e.additional_stores, 1) > 0
      ON CONFLICT (employee_id, store_id) DO NOTHING
    ';
  END IF;
END $$;

-- RLS
ALTER TABLE user_stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_user_stores ON user_stores
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- ─── 3b. department_manager_history — audit trail ───

CREATE TABLE IF NOT EXISTS department_manager_history (
  id SERIAL PRIMARY KEY,
  organization_id INT REFERENCES organizations(id),
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  store_id INT REFERENCES stores(id),
  manager_id INT REFERENCES employees(id),
  manager_employee_number TEXT,
  manager_name TEXT NOT NULL,
  effective_date DATE NOT NULL,
  end_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dept_mgr_history_dept ON department_manager_history(department_id);
CREATE INDEX IF NOT EXISTS idx_dept_mgr_history_manager ON department_manager_history(manager_id);
CREATE INDEX IF NOT EXISTS idx_dept_mgr_history_effective ON department_manager_history(effective_date DESC);

-- Seed with current department managers
INSERT INTO department_manager_history (
  organization_id, department_id, manager_id, manager_employee_number, manager_name, effective_date
)
SELECT
  d.organization_id,
  d.id,
  d.manager_id,
  e.employee_number,
  e.name,
  COALESCE(d.manager_effective_date, CURRENT_DATE)
FROM departments d
JOIN employees e ON e.id = d.manager_id
WHERE d.manager_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE department_manager_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_dept_mgr_history ON department_manager_history
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- ─── 3c. Auto-record manager changes via trigger ───

CREATE OR REPLACE FUNCTION track_department_manager_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Close previous manager's record
  IF OLD.manager_id IS NOT NULL AND OLD.manager_id IS DISTINCT FROM NEW.manager_id THEN
    UPDATE department_manager_history
    SET end_date = CURRENT_DATE
    WHERE department_id = NEW.id
      AND manager_id = OLD.manager_id
      AND end_date IS NULL;
  END IF;

  -- Insert new manager record
  IF NEW.manager_id IS NOT NULL AND NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
    INSERT INTO department_manager_history (
      organization_id, department_id, manager_id, manager_employee_number, manager_name, effective_date
    )
    SELECT
      NEW.organization_id,
      NEW.id,
      NEW.manager_id,
      e.employee_number,
      e.name,
      COALESCE(NEW.manager_effective_date, CURRENT_DATE)
    FROM employees e
    WHERE e.id = NEW.manager_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_track_dept_manager ON departments;
CREATE TRIGGER trg_track_dept_manager
  AFTER UPDATE ON departments
  FOR EACH ROW
  WHEN (OLD.manager_id IS DISTINCT FROM NEW.manager_id)
  EXECUTE FUNCTION track_department_manager_change();
