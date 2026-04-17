-- ============================================================
-- 費用申請：加入品項明細（JSONB）+ 供應商欄位
-- items: [{"name":"辦公椅","qty":5,"unit_price":2000,"subtotal":10000}, ...]
-- ============================================================

ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS supplier TEXT;
ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]';
