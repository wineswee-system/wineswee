-- ============================================================
-- 福利政策系統：per-store / per-employee 客製化假別+獎金
-- ============================================================

-- ─── 1. benefit_policies：彈性福利政策表 ───
CREATE TABLE benefit_policies (
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id),
  store_id INT REFERENCES stores(id) ON DELETE SET NULL,      -- NULL = 全公司
  employee_id INT REFERENCES employees(id) ON DELETE CASCADE, -- NULL = 適用範圍內所有人
  category TEXT NOT NULL CHECK (category IN ('leave', 'bonus')),
  code TEXT NOT NULL,
  -- leave code: 'annual','sick','personal','marriage' 等（對應 leavePolicy.js LEAVE_TYPES）
  -- bonus code: 'attendance_bonus','sales_commission','performance' 等（自訂）
  config JSONB NOT NULL DEFAULT '{}',
  -- leave 範例: {"extra_days": 2, "extra_hours": 0, "description": "門市額外特休"}
  -- bonus 範例: {"type": "fixed", "amount": 3000, "period": "monthly"}
  --          或: {"type": "percent", "base": "sales", "rate": 0.03, "cap": 50000}
  --          或: {"type": "milestone", "tiers": [{"target": 100000, "reward": 2000}, {"target": 200000, "reward": 5000}]}
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,           -- NULL = 永久生效
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 解析優先序：employee_id + store_id > store_id only > global (NULL/NULL)
-- 同一範圍同一 code 只能有一筆生效中的政策
CREATE UNIQUE INDEX uq_benefit_policy
  ON benefit_policies (tenant_id, COALESCE(store_id, 0), COALESCE(employee_id, 0), category, code)
  WHERE is_active = TRUE AND effective_to IS NULL;

CREATE INDEX idx_benefit_store ON benefit_policies (store_id, category, is_active);
CREATE INDEX idx_benefit_employee ON benefit_policies (employee_id, category, is_active);

-- RLS
ALTER TABLE benefit_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bp ON benefit_policies
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- ─── 2. bonus_records：獎金發放紀錄（修復 Bonus.jsx 缺表） ───
CREATE TABLE bonus_records (
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id),
  employee_id INT REFERENCES employees(id) ON DELETE SET NULL,
  employee_name TEXT NOT NULL,
  store_id INT REFERENCES stores(id) ON DELETE SET NULL,
  role_type TEXT DEFAULT '業務',
  period TEXT NOT NULL,          -- 'YYYY-MM'
  policy_id INT REFERENCES benefit_policies(id) ON DELETE SET NULL,
  base_bonus INT DEFAULT 0,
  data_bonus INT DEFAULT 0,
  total_bonus INT DEFAULT 0,
  status TEXT DEFAULT '待發放' CHECK (status IN ('待發放', '已核准', '已發放', '已拒絕')),
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bonus_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_br ON bonus_records
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- ─── 3. bonus_settings：獎金指標設定（修復 Bonus.jsx 缺表） ───
CREATE TABLE bonus_settings (
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id),
  store_id INT REFERENCES stores(id) ON DELETE SET NULL,  -- NULL = 全公司
  role_type TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  target_value NUMERIC DEFAULT 0,
  weight NUMERIC DEFAULT 1,
  reward_amount NUMERIC DEFAULT 0,
  period TEXT DEFAULT '月',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bonus_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bs ON bonus_settings
  FOR ALL USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- CHECK: 獎金金額不可為負
ALTER TABLE bonus_records ADD CONSTRAINT chk_bonus_positive CHECK (total_bonus >= 0);
