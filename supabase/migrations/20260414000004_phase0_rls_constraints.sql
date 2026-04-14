-- ============================================================
-- Phase 0: 全表 RLS 擴展 + CHECK 約束
-- 目的：客戶上線前的最低安全防護
-- ============================================================

-- ─── 1. 對所有含 tenant_id 但尚未啟用 RLS 的表啟用 RLS ───

-- HR
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_attendance ON attendance_records
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_leave ON leave_requests
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE overtime_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_overtime ON overtime_requests
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE salary_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_salary ON salary_records
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_companies ON companies
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_stores ON stores
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_departments ON departments
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- Procurement
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pr ON purchase_requests
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_gr ON goods_receipts
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- Finance
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_jl ON journal_lines
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ar ON accounts_receivable
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE accounts_payable ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ap ON accounts_payable
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_budgets ON budgets
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bank ON bank_transactions
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_cc ON cost_centers
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- Manufacturing
ALTER TABLE bom ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bom ON bom
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE manufacturing_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_mo ON manufacturing_orders
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE quality_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_qi ON quality_inspections
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- Inventory
ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_lots ON inventory_lots
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sc ON stock_counts
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- Sales
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_quot ON quotations
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_promo ON promotions
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_returns ON returns
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- POS
ALTER TABLE pos_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_shifts ON pos_shifts
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- Logistics
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ship ON shipments
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- Workflow & System
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_wf ON workflows
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tasks ON tasks
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit ON audit_logs
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_notif ON notifications
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_approval ON approval_requests
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- ─── 2. CHECK 約束：資料完整性的最後防線 ───

-- 薪資不可為負
ALTER TABLE salary_records ADD CONSTRAINT chk_salary_positive_net
  CHECK (net_salary >= 0);
ALTER TABLE salary_records ADD CONSTRAINT chk_salary_positive_base
  CHECK (base_salary >= 0);

-- 庫存不可為負
ALTER TABLE inventory_lots ADD CONSTRAINT chk_lots_positive_qty
  CHECK (quantity >= 0);

-- POS 交易金額驗證
ALTER TABLE pos_transactions ADD CONSTRAINT chk_pos_positive_total
  CHECK (total >= 0);
ALTER TABLE pos_transactions ADD CONSTRAINT chk_pos_positive_subtotal
  CHECK (subtotal >= 0);

-- 會計分錄借貸不可為負
ALTER TABLE journal_lines ADD CONSTRAINT chk_jl_debit_positive
  CHECK (debit >= 0);
ALTER TABLE journal_lines ADD CONSTRAINT chk_jl_credit_positive
  CHECK (credit >= 0);
-- 同一行不可同時有借方和貸方
ALTER TABLE journal_lines ADD CONSTRAINT chk_jl_not_both
  CHECK (NOT (debit > 0 AND credit > 0));

-- 採購單金額不可為負
ALTER TABLE purchase_orders ADD CONSTRAINT chk_po_positive_total
  CHECK (total_amount >= 0);

-- 銷售單金額不可為負
ALTER TABLE sales_orders ADD CONSTRAINT chk_so_positive_total
  CHECK (total >= 0);

-- 假單天數必須為正
ALTER TABLE leave_requests ADD CONSTRAINT chk_leave_positive_days
  CHECK (days > 0);

-- 加班時數必須為正且不超過法定上限（單日 12 小時）
ALTER TABLE overtime_requests ADD CONSTRAINT chk_ot_positive_hours
  CHECK (hours > 0 AND hours <= 12);
