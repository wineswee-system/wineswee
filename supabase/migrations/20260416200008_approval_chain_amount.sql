-- ============================================================
-- 簽核鏈加入金額門檻 + 啟用狀態
-- 依金額自動匹配對應的簽核鏈
-- ============================================================

ALTER TABLE approval_chains ADD COLUMN IF NOT EXISTS min_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE approval_chains ADD COLUMN IF NOT EXISTS max_amount NUMERIC(12,2);
ALTER TABLE approval_chains ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_approval_chains_amount ON approval_chains(category, min_amount, max_amount);
CREATE INDEX IF NOT EXISTS idx_approval_chains_active ON approval_chains(is_active);

COMMENT ON COLUMN approval_chains.min_amount IS '最低金額門檻（含），0 表示無下限';
COMMENT ON COLUMN approval_chains.max_amount IS '最高金額門檻（含），NULL 表示無上限';
COMMENT ON COLUMN approval_chains.is_active IS '是否啟用';
