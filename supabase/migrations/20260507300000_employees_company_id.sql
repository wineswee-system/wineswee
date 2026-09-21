-- ============================================================
-- Add employees.company_id FK + backfill + trigger sync
-- Closes the model gap: company → employees direct link
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(id);

-- Primary backfill: through store
UPDATE employees e SET company_id = s.company_id
FROM stores s
WHERE e.store_id = s.id
  AND e.company_id IS NULL
  AND s.company_id IS NOT NULL;

-- Fallback backfill: through department (for employees with no store)
UPDATE employees e SET company_id = d.company_id
FROM departments d
WHERE e.department_id = d.id
  AND e.company_id IS NULL
  AND d.company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_company_id ON employees(company_id);

-- Extend the existing sync trigger so company_id auto-resolves from store_id
-- (primary) or department_id (fallback) whenever those FKs change.
CREATE OR REPLACE FUNCTION sync_employee_fk_text()
RETURNS TRIGGER AS $$
BEGIN
  -- FK → TEXT
  IF NEW.department_id IS NOT NULL AND NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    SELECT name INTO NEW.dept FROM departments WHERE id = NEW.department_id;
  END IF;
  IF NEW.store_id IS NOT NULL AND NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    SELECT name INTO NEW.store FROM stores WHERE id = NEW.store_id;
  END IF;
  IF NEW.supervisor_id IS NOT NULL AND NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id THEN
    SELECT name INTO NEW.supervisor FROM employees WHERE id = NEW.supervisor_id;
  END IF;

  -- TEXT → FK
  IF NEW.dept IS NOT NULL AND NEW.dept IS DISTINCT FROM OLD.dept AND NEW.department_id IS NULL THEN
    SELECT id INTO NEW.department_id FROM departments WHERE name = NEW.dept LIMIT 1;
  END IF;
  IF NEW.store IS NOT NULL AND NEW.store IS DISTINCT FROM OLD.store AND NEW.store_id IS NULL THEN
    SELECT id INTO NEW.store_id FROM stores WHERE name = NEW.store LIMIT 1;
  END IF;
  IF NEW.supervisor IS NOT NULL AND NEW.supervisor IS DISTINCT FROM OLD.supervisor AND NEW.supervisor_id IS NULL THEN
    SELECT id INTO NEW.supervisor_id FROM employees WHERE name = NEW.supervisor LIMIT 1;
  END IF;

  -- Resolve company_id: store wins, department is fallback
  IF NEW.store_id IS NOT NULL AND NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    SELECT company_id INTO NEW.company_id FROM stores WHERE id = NEW.store_id;
  END IF;
  IF NEW.company_id IS NULL
     AND NEW.department_id IS NOT NULL
     AND NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    SELECT company_id INTO NEW.company_id FROM departments WHERE id = NEW.department_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_employee_fk_text ON employees;
CREATE TRIGGER trg_sync_employee_fk_text
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION sync_employee_fk_text();
