-- ============================================================
-- Phase 8: FK columns for POS, Sales, Purchase, Finance tables
-- Purpose: Add employee_id/store_id FKs to remaining business tables
-- ============================================================

-- ─── POS ───

ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS store_id INT REFERENCES stores(id);
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS cashier_id INT REFERENCES employees(id);
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS member_id_fk INT REFERENCES members(id);

ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS store_id INT REFERENCES stores(id);
ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS cashier_id INT REFERENCES employees(id);

-- Backfill
UPDATE pos_transactions pt SET store_id = s.id
FROM stores s WHERE pt.store = s.name AND pt.store_id IS NULL;

UPDATE pos_transactions pt SET cashier_id = e.id
FROM employees e WHERE pt.cashier = e.name AND pt.cashier_id IS NULL;

UPDATE pos_shifts ps SET store_id = s.id
FROM stores s WHERE ps.store = s.name AND ps.store_id IS NULL;

UPDATE pos_shifts ps SET cashier_id = e.id
FROM employees e WHERE ps.cashier = e.name AND ps.cashier_id IS NULL;

-- ─── Sales ───

ALTER TABLE quotations ADD COLUMN IF NOT EXISTS created_by_id INT REFERENCES employees(id);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS created_by_id INT REFERENCES employees(id);
ALTER TABLE returns ADD COLUMN IF NOT EXISTS processed_by_id INT REFERENCES employees(id);

UPDATE quotations q SET created_by_id = e.id
FROM employees e WHERE q.created_by = e.name AND q.created_by_id IS NULL;

UPDATE sales_orders so SET created_by_id = e.id
FROM employees e WHERE so.created_by = e.name AND so.created_by_id IS NULL;

UPDATE returns r SET processed_by_id = e.id
FROM employees e WHERE r.processed_by = e.name AND r.processed_by_id IS NULL;

-- ─── Purchase ───

ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS requester_id INT REFERENCES employees(id);
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS department_id INT REFERENCES departments(id);
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS approved_by_id INT REFERENCES employees(id);

UPDATE purchase_requests pr SET requester_id = e.id
FROM employees e WHERE pr.requester = e.name AND pr.requester_id IS NULL;

UPDATE purchase_requests pr SET department_id = d.id
FROM departments d WHERE pr.department = d.name AND pr.department_id IS NULL;

UPDATE purchase_requests pr SET approved_by_id = e.id
FROM employees e WHERE pr.approved_by = e.name AND pr.approved_by_id IS NULL;

-- ─── Finance ───

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entries') THEN
    EXECUTE 'ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS created_by_id INT REFERENCES employees(id)';
    EXECUTE 'UPDATE journal_entries je SET created_by_id = e.id FROM employees e WHERE je.created_by = e.name AND je.created_by_id IS NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'budgets') THEN
    EXECUTE 'ALTER TABLE budgets ADD COLUMN IF NOT EXISTS department_id INT REFERENCES departments(id)';
    EXECUTE 'UPDATE budgets b SET department_id = d.id FROM departments d WHERE b.department = d.name AND b.department_id IS NULL';
  END IF;
END $$;

-- ─── Workflow ───

ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS started_by_id INT REFERENCES employees(id);

UPDATE workflow_instances wi SET started_by_id = e.id
FROM employees e WHERE wi.started_by = e.name AND wi.started_by_id IS NULL;

-- ─── Indexes ───

CREATE INDEX IF NOT EXISTS idx_pos_txn_store_id ON pos_transactions(store_id);
CREATE INDEX IF NOT EXISTS idx_pos_txn_cashier_id ON pos_transactions(cashier_id);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_store_id ON pos_shifts(store_id);
CREATE INDEX IF NOT EXISTS idx_purchase_req_requester ON purchase_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_workflow_inst_started ON workflow_instances(started_by_id);
