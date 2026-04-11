-- ============================================================
--  Enterprise Performance Indexes + RLS Policies
--  Run in Supabase Dashboard > SQL Editor
-- ============================================================

-- ============================================================
--  1. COMPOSITE INDEXES FOR COMMON QUERY PATTERNS
-- ============================================================

-- Employees: multi-tenant queries
CREATE INDEX IF NOT EXISTS idx_employees_store_status ON employees(store, status);
CREATE INDEX IF NOT EXISTS idx_employees_dept_status ON employees(dept, status);

-- Attendance: employee + date range (most common query)
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance_records(employee, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_date_status ON attendance_records(date, status);

-- Leave requests: employee + status (approval queue)
CREATE INDEX IF NOT EXISTS idx_leave_employee_status ON leave_requests(employee, status);
CREATE INDEX IF NOT EXISTS idx_leave_dates ON leave_requests(start_date, end_date);

-- Salary: employee + month (payroll lookups)
CREATE INDEX IF NOT EXISTS idx_salary_employee_month ON salary_records(employee, month DESC);

-- Schedule: store + date (shift planning)
CREATE INDEX IF NOT EXISTS idx_schedule_store_date ON schedule_data(store, date);

-- Purchase orders: supplier + status
CREATE INDEX IF NOT EXISTS idx_po_supplier_status ON purchase_orders(supplier, status);
CREATE INDEX IF NOT EXISTS idx_po_created ON purchase_orders(created_at DESC);

-- Goods receipts: PO reference
CREATE INDEX IF NOT EXISTS idx_gr_po_id ON goods_receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_gr_created ON goods_receipts(created_at DESC);

-- Accounts receivable: status + due date (collections)
CREATE INDEX IF NOT EXISTS idx_ar_status_due ON accounts_receivable(status, due_date);
CREATE INDEX IF NOT EXISTS idx_ar_customer ON accounts_receivable(customer);

-- Accounts payable: status + due date (payment scheduling)
CREATE INDEX IF NOT EXISTS idx_ap_status_due ON accounts_payable(status, due_date);
CREATE INDEX IF NOT EXISTS idx_ap_supplier ON accounts_payable(supplier);

-- Journal entries: date + status (period close, reporting)
CREATE INDEX IF NOT EXISTS idx_je_date_status ON journal_entries(entry_date, status);
CREATE INDEX IF NOT EXISTS idx_je_source ON journal_entries(source, source_id);

-- Journal lines: entry + account (trial balance, P&L)
CREATE INDEX IF NOT EXISTS idx_jl_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jl_account ON journal_lines(account_code);

-- Sales orders: customer + status
CREATE INDEX IF NOT EXISTS idx_so_customer_status ON sales_orders(customer, status);
CREATE INDEX IF NOT EXISTS idx_so_created ON sales_orders(created_at DESC);

-- POS transactions: store + date (daily reports)
CREATE INDEX IF NOT EXISTS idx_pos_store_date ON pos_transactions(store, date DESC);
CREATE INDEX IF NOT EXISTS idx_pos_cashier ON pos_transactions(cashier);

-- Manufacturing orders: status + priority
CREATE INDEX IF NOT EXISTS idx_mo_status ON manufacturing_orders(status);
CREATE INDEX IF NOT EXISTS idx_mo_created ON manufacturing_orders(created_at DESC);

-- Stock levels: SKU lookups (hot path for POS/Sales)
CREATE INDEX IF NOT EXISTS idx_stock_sku ON stock_levels(sku_name);

-- Inventory cost layers: SKU + costing method
CREATE INDEX IF NOT EXISTS idx_cost_layers_sku ON inventory_cost_layers(sku_id);

-- BOM: product lookup
CREATE INDEX IF NOT EXISTS idx_bom_product ON bom(product_name);

-- Customers: name search + segment
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- Members: customer + tier (loyalty queries)
CREATE INDEX IF NOT EXISTS idx_members_customer ON members(customer_id);
CREATE INDEX IF NOT EXISTS idx_members_tier ON members(tier);

-- Notifications: read status (unread count is hot query)
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read, created_at DESC);

-- Dead letter queue: status (retry processing)
CREATE INDEX IF NOT EXISTS idx_dlq_status ON dead_letter_queue(status);
CREATE INDEX IF NOT EXISTS idx_dlq_event_type ON dead_letter_queue(event_type);

-- Outbox table (new, for transactional event publishing)
CREATE TABLE IF NOT EXISTS event_outbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type TEXT NOT NULL,
  domain TEXT NOT NULL,
  payload JSONB NOT NULL,
  metadata JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',    -- pending / published / failed
  retry_count INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON event_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_domain ON event_outbox(domain);

-- Leave entitlements (used by HR handlers)
CREATE TABLE IF NOT EXISTS leave_entitlements (
  id SERIAL PRIMARY KEY,
  employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
  year INT NOT NULL,
  leave_type TEXT NOT NULL,
  total_days NUMERIC(5,1) NOT NULL DEFAULT 0,
  used_days NUMERIC(5,1) NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, year, leave_type)
);

-- DLQ monitoring view (for error budget tracking)
CREATE OR REPLACE VIEW dlq_stats AS
SELECT
  event_type,
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM dead_letter_queue
GROUP BY event_type, status;

-- ============================================================
--  2. ROW LEVEL SECURITY (RLS) — TENANT ISOLATION
-- ============================================================

-- Enable RLS on all tenant-scoped tables
-- NOTE: These require a tenant_id column. Tables without it
-- should be migrated to include tenant_id for multi-tenant isolation.

-- Business events: immutable audit trail (append-only)
ALTER TABLE business_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_events_insert" ON business_events
  FOR INSERT WITH CHECK (true);

CREATE POLICY "business_events_select" ON business_events
  FOR SELECT USING (true);

-- No UPDATE or DELETE policies = immutable audit trail

-- Dead letter queue: append + read only
ALTER TABLE dead_letter_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dlq_insert" ON dead_letter_queue
  FOR INSERT WITH CHECK (true);

CREATE POLICY "dlq_select" ON dead_letter_queue
  FOR SELECT USING (true);

CREATE POLICY "dlq_update_status" ON dead_letter_queue
  FOR UPDATE USING (true)
  WITH CHECK (true);

-- Event outbox: system-managed
ALTER TABLE event_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outbox_all" ON event_outbox
  FOR ALL USING (true) WITH CHECK (true);

-- System logs: immutable
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_logs_insert" ON system_logs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "system_logs_select" ON system_logs
  FOR SELECT USING (true);

-- Error logs: append + read + resolve only
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "error_logs_insert" ON error_logs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "error_logs_select" ON error_logs
  FOR SELECT USING (true);

CREATE POLICY "error_logs_resolve" ON error_logs
  FOR UPDATE USING (true)
  WITH CHECK (true);

-- User activity: immutable
ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_activity_insert" ON user_activity
  FOR INSERT WITH CHECK (true);

CREATE POLICY "user_activity_select" ON user_activity
  FOR SELECT USING (true);

-- ============================================================
--  3. MATERIALIZED VIEWS FOR CQRS READ MODELS
-- ============================================================

-- Daily sales summary (refreshed periodically for dashboards)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_sales AS
SELECT
  date,
  store,
  COUNT(*) as transaction_count,
  SUM(total) as total_sales,
  AVG(total) as avg_transaction,
  SUM(CASE WHEN payment_method = '現金' THEN total ELSE 0 END) as cash_sales,
  SUM(CASE WHEN payment_method != '現金' THEN total ELSE 0 END) as card_sales
FROM pos_transactions
GROUP BY date, store;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_sales ON mv_daily_sales(date, store);

-- Monthly revenue by customer (for CRM analytics)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_customer_revenue AS
SELECT
  customer,
  date_trunc('month', created_at) as month,
  COUNT(*) as order_count,
  SUM(amount) as total_revenue,
  SUM(paid_amount) as total_collected
FROM accounts_receivable
GROUP BY customer, date_trunc('month', created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_customer_revenue ON mv_customer_revenue(customer, month);

-- Inventory valuation summary (for finance dashboards)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_inventory_summary AS
SELECT
  sku_name,
  quantity,
  COALESCE(reserved_qty, 0) as reserved_qty,
  quantity - COALESCE(reserved_qty, 0) as available_qty
FROM stock_levels
WHERE quantity > 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_inventory_summary ON mv_inventory_summary(sku_name);

-- Refresh function (call from cron or edge function)
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sales;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_customer_revenue;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_inventory_summary;
END;
$$ LANGUAGE plpgsql;
