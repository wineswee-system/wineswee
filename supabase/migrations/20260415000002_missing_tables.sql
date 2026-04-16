-- ============================================================
-- 補齊所有程式碼有引用但 DB 可能缺少的表
-- 使用 IF NOT EXISTS 確保不會覆蓋已存在的表
-- ============================================================

-- ─── HR 相關 ───
CREATE TABLE IF NOT EXISTS schedules (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  date DATE NOT NULL,
  shift TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee, date)
);

CREATE TABLE IF NOT EXISTS off_requests (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clock_corrections (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  date DATE NOT NULL,
  type TEXT DEFAULT '上班打卡',
  correction_time TIME,
  reason TEXT,
  status TEXT DEFAULT '待審核',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shift_definitions (
  id SERIAL PRIMARY KEY,
  store_id INT REFERENCES stores(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  break_minutes INT DEFAULT 60,
  color TEXT DEFAULT '#3b82f6',
  sort_order INT DEFAULT 0,
  employee_type TEXT DEFAULT 'all',
  day_type TEXT DEFAULT 'all',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shift_swaps (
  id SERIAL PRIMARY KEY,
  requester TEXT NOT NULL,
  target TEXT NOT NULL,
  date DATE NOT NULL,
  status TEXT DEFAULT '待確認',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_shift_preferences (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  shift_name TEXT,
  preference TEXT DEFAULT '都可以',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS overtime_records (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  date DATE,
  hours NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_records (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  type TEXT,
  days NUMERIC DEFAULT 0,
  year INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_entitlements (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  type TEXT,
  total_days NUMERIC DEFAULT 0,
  used_days NUMERIC DEFAULT 0,
  year INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_settlements (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  type TEXT,
  unsettled_days NUMERIC DEFAULT 0,
  settlement_amount NUMERIC DEFAULT 0,
  year INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salary_revisions (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  old_salary NUMERIC,
  new_salary NUMERIC,
  effective_date DATE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS performance_goals (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  title TEXT,
  target TEXT,
  progress NUMERIC DEFAULT 0,
  status TEXT DEFAULT '進行中',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS onboarding_plans (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT '待開始',
  due_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offboarding_plans (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT '待開始',
  due_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tax_filings (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  year INT,
  type TEXT,
  amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT '待申報',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── CRM 相關 ───
CREATE TABLE IF NOT EXISTS opportunities (
  id SERIAL PRIMARY KEY,
  name TEXT,
  customer TEXT,
  amount NUMERIC DEFAULT 0,
  stage TEXT DEFAULT '探索',
  probability INT DEFAULT 0,
  owner TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id SERIAL PRIMARY KEY,
  customer TEXT,
  type TEXT,
  content TEXT,
  contact_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_tickets (
  id SERIAL PRIMARY KEY,
  customer TEXT,
  subject TEXT,
  description TEXT,
  status TEXT DEFAULT '待處理',
  priority TEXT DEFAULT '一般',
  assigned_to TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  status TEXT DEFAULT '草稿',
  budget NUMERIC DEFAULT 0,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS line_users (
  id SERIAL PRIMARY KEY,
  line_user_id TEXT UNIQUE,
  employee_id INT REFERENCES employees(id),
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── WMS 相關 ───
CREATE TABLE IF NOT EXISTS inbound_orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT,
  supplier TEXT,
  status TEXT DEFAULT '待收貨',
  expected_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inbound_items (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES inbound_orders(id) ON DELETE CASCADE,
  sku_code TEXT,
  sku_name TEXT,
  expected_qty NUMERIC DEFAULT 0,
  received_qty NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbound_orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT,
  customer TEXT,
  status TEXT DEFAULT '待出貨',
  shipped_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbound_items (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES outbound_orders(id) ON DELETE CASCADE,
  sku_code TEXT,
  sku_name TEXT,
  qty NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 門市設定 ───
CREATE TABLE IF NOT EXISTS store_settings (
  id SERIAL PRIMARY KEY,
  store_id INT REFERENCES stores(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, key)
);

CREATE TABLE IF NOT EXISTS store_staffing (
  id SERIAL PRIMARY KEY,
  store_id INT REFERENCES stores(id) ON DELETE CASCADE,
  shift_name TEXT,
  day_of_week INT,
  time_start TEXT,
  time_end TEXT,
  required_count INT DEFAULT 1,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 流程/系統 ───
CREATE TABLE IF NOT EXISTS sop_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  steps JSONB DEFAULT '[]',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS module_access (
  id SERIAL PRIMARY KEY,
  role_id INT,
  module TEXT NOT NULL,
  can_read BOOLEAN DEFAULT TRUE,
  can_write BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_outbox (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- ─── Materialized Views (簡化為一般表) ───
CREATE TABLE IF NOT EXISTS mv_daily_sales (
  id SERIAL PRIMARY KEY,
  date DATE,
  store TEXT,
  total_revenue NUMERIC DEFAULT 0,
  transaction_count INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mv_customer_revenue (
  id SERIAL PRIMARY KEY,
  customer TEXT,
  total_revenue NUMERIC DEFAULT 0,
  order_count INT DEFAULT 0,
  last_order_date DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Sales 相關 ───
CREATE TABLE IF NOT EXISTS sales_returns (
  id SERIAL PRIMARY KEY,
  return_number TEXT,
  original_order TEXT,
  customer TEXT,
  total_refund NUMERIC DEFAULT 0,
  reason TEXT,
  status TEXT DEFAULT '待處理',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
