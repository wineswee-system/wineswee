-- ============================================================
-- Phase 2: Core Entity FK Columns + Sync Triggers
-- Purpose: Add proper FK relationships alongside TEXT columns
-- Strategy: Dual-column — triggers auto-sync TEXT↔FK for backward compatibility
-- ============================================================

-- ─── 2a. Companies — add organization_id ───

ALTER TABLE companies ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id);

-- Backfill from tenant bridge
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'tenant_id') THEN
    EXECUTE 'UPDATE companies c
    SET organization_id = t.organization_id
    FROM tenants t
    WHERE c.tenant_id = t.id
      AND c.organization_id IS NULL';
  END IF;
END $$;

-- ─── 2b. Stores — add FK columns ───

ALTER TABLE stores ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(id);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS manager_id INT REFERENCES employees(id);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS store_code TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS store_type TEXT DEFAULT 'retail';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS department_id INT REFERENCES departments(id);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS manager_effective_date DATE;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS late_tolerance_minutes INT DEFAULT 5;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS early_clock_minutes INT DEFAULT 30;

-- Backfill company_id from TEXT company column
UPDATE stores s
SET company_id = c.id
FROM companies c
WHERE s.company = c.name
  AND s.company_id IS NULL;

-- Backfill organization_id from company
UPDATE stores s
SET organization_id = c.organization_id
FROM companies c
WHERE s.company_id = c.id
  AND s.organization_id IS NULL;

-- Backfill manager_id from TEXT manager column
UPDATE stores s
SET manager_id = e.id
FROM employees e
WHERE s.manager = e.name
  AND s.manager_id IS NULL;

-- Auto-generate store_code for existing stores
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM stores WHERE store_code IS NULL
)
UPDATE stores SET store_code = 'S-' || LPAD(numbered.rn::TEXT, 3, '0')
FROM numbered WHERE stores.id = numbered.id;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stores_company_id ON stores(company_id);
CREATE INDEX IF NOT EXISTS idx_stores_organization_id ON stores(organization_id);
CREATE INDEX IF NOT EXISTS idx_stores_manager_id ON stores(manager_id);

-- ─── 2c. Departments — add hierarchy + FKs ───

ALTER TABLE departments ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(id);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS manager_id INT REFERENCES employees(id);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS level TEXT DEFAULT '部';
ALTER TABLE departments ADD COLUMN IF NOT EXISTS parent_department_id INT REFERENCES departments(id);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS manager_effective_date DATE;

-- Backfill manager_id from TEXT head column
UPDATE departments d
SET manager_id = e.id
FROM employees e
WHERE d.head = e.name
  AND d.manager_id IS NULL;

-- Backfill organization_id from tenant
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'departments' AND column_name = 'tenant_id') THEN
    EXECUTE 'UPDATE departments d
    SET organization_id = t.organization_id
    FROM tenants t
    WHERE d.tenant_id = t.id
      AND d.organization_id IS NULL';
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_departments_organization_id ON departments(organization_id);
CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_department_id);
CREATE INDEX IF NOT EXISTS idx_departments_manager_id ON departments(manager_id);

-- ─── 2d. Employees — add FK columns + expanded fields ───

ALTER TABLE employees ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS department_id INT REFERENCES departments(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS store_id INT REFERENCES stores(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS supervisor_id INT REFERENCES employees(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employee_number TEXT UNIQUE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_manager BOOLEAN DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_line_manager BOOLEAN DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS reporting_to INT REFERENCES employees(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_permit_number TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_permit_expiry DATE;

-- Backfill department_id from TEXT dept
UPDATE employees e
SET department_id = d.id
FROM departments d
WHERE e.dept = d.name
  AND e.department_id IS NULL;

-- Backfill store_id from TEXT store
UPDATE employees e
SET store_id = s.id
FROM stores s
WHERE e.store = s.name
  AND e.store_id IS NULL;

-- Backfill supervisor_id from TEXT supervisor
UPDATE employees e
SET supervisor_id = s.id
FROM employees s
WHERE e.supervisor = s.name
  AND e.supervisor_id IS NULL;

-- Backfill reporting_to = supervisor_id
UPDATE employees
SET reporting_to = supervisor_id
WHERE supervisor_id IS NOT NULL
  AND reporting_to IS NULL;

-- Backfill organization_id from tenant
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'tenant_id') THEN
    EXECUTE 'UPDATE employees e
    SET organization_id = t.organization_id
    FROM tenants t
    WHERE e.tenant_id = t.id
      AND e.organization_id IS NULL';
  END IF;
END $$;

-- Auto-generate employee_number for existing rows
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY COALESCE(join_date, created_at), id) AS rn
  FROM employees WHERE employee_number IS NULL
)
UPDATE employees SET employee_number = 'EMP-' || LPAD(numbered.rn::TEXT, 3, '0')
FROM numbered WHERE employees.id = numbered.id;

-- Backfill is_line_manager from line_admin (if column exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'line_admin') THEN
    EXECUTE 'UPDATE employees SET is_line_manager = line_admin WHERE line_admin IS NOT NULL AND is_line_manager = false';
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_employees_organization_id ON employees(organization_id);
CREATE INDEX IF NOT EXISTS idx_employees_department_id ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_store_id ON employees(store_id);
CREATE INDEX IF NOT EXISTS idx_employees_supervisor_id ON employees(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_employees_employee_number ON employees(employee_number);

-- ─── 2e. Sync Triggers — backward compatibility ───

-- Employee: sync FK ↔ TEXT
CREATE OR REPLACE FUNCTION sync_employee_fk_text()
RETURNS TRIGGER AS $$
BEGIN
  -- FK → TEXT: when FK is set, populate TEXT column
  IF NEW.department_id IS NOT NULL AND NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    SELECT name INTO NEW.dept FROM departments WHERE id = NEW.department_id;
  END IF;
  IF NEW.store_id IS NOT NULL AND NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    SELECT name INTO NEW.store FROM stores WHERE id = NEW.store_id;
  END IF;
  IF NEW.supervisor_id IS NOT NULL AND NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id THEN
    SELECT name INTO NEW.supervisor FROM employees WHERE id = NEW.supervisor_id;
  END IF;

  -- TEXT → FK: when TEXT is set and FK is null, resolve FK
  IF NEW.dept IS NOT NULL AND NEW.dept IS DISTINCT FROM OLD.dept AND NEW.department_id IS NULL THEN
    SELECT id INTO NEW.department_id FROM departments WHERE name = NEW.dept LIMIT 1;
  END IF;
  IF NEW.store IS NOT NULL AND NEW.store IS DISTINCT FROM OLD.store AND NEW.store_id IS NULL THEN
    SELECT id INTO NEW.store_id FROM stores WHERE name = NEW.store LIMIT 1;
  END IF;
  IF NEW.supervisor IS NOT NULL AND NEW.supervisor IS DISTINCT FROM OLD.supervisor AND NEW.supervisor_id IS NULL THEN
    SELECT id INTO NEW.supervisor_id FROM employees WHERE name = NEW.supervisor LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_employee_fk_text ON employees;
CREATE TRIGGER trg_sync_employee_fk_text
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION sync_employee_fk_text();

-- Store: sync FK ↔ TEXT
CREATE OR REPLACE FUNCTION sync_store_fk_text()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.company_id IS NOT NULL AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    SELECT name INTO NEW.company FROM companies WHERE id = NEW.company_id;
  END IF;
  IF NEW.manager_id IS NOT NULL AND NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
    SELECT name INTO NEW.manager FROM employees WHERE id = NEW.manager_id;
  END IF;

  IF NEW.company IS NOT NULL AND NEW.company IS DISTINCT FROM OLD.company AND NEW.company_id IS NULL THEN
    SELECT id INTO NEW.company_id FROM companies WHERE name = NEW.company LIMIT 1;
  END IF;
  IF NEW.manager IS NOT NULL AND NEW.manager IS DISTINCT FROM OLD.manager AND NEW.manager_id IS NULL THEN
    SELECT id INTO NEW.manager_id FROM employees WHERE name = NEW.manager LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_store_fk_text ON stores;
CREATE TRIGGER trg_sync_store_fk_text
  BEFORE INSERT OR UPDATE ON stores
  FOR EACH ROW EXECUTE FUNCTION sync_store_fk_text();

-- Department: sync FK ↔ TEXT
CREATE OR REPLACE FUNCTION sync_department_fk_text()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.manager_id IS NOT NULL AND NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
    SELECT name INTO NEW.head FROM employees WHERE id = NEW.manager_id;
  END IF;

  IF NEW.head IS NOT NULL AND NEW.head IS DISTINCT FROM OLD.head AND NEW.manager_id IS NULL THEN
    SELECT id INTO NEW.manager_id FROM employees WHERE name = NEW.head LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_department_fk_text ON departments;
CREATE TRIGGER trg_sync_department_fk_text
  BEFORE INSERT OR UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION sync_department_fk_text();
