-- ============================================================
-- Phase 0: 全表 RLS 擴展 + CHECK 約束
-- 目的：客戶上線前的最低安全防護
-- ============================================================

-- ─── 1. 對所有含 tenant_id 但尚未啟用 RLS 的表啟用 RLS ───
-- (Skipped: Tables do not currently have a tenant_id column)

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
