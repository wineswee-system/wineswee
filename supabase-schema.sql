-- ============================================================
--  SME Ops System — Supabase Schema + Seed Data
--  貼到 Supabase Dashboard > SQL Editor > New Query 執行
--
--  WARNING: STALE — DO NOT USE FOR RLS POLICY REFERENCE.
--  This is a one-time schema dump. The authoritative source for all
--  RLS policies and helper functions is supabase/migrations/.
--  The tenant_isolation_* policies below reference
--  current_setting('app.tenant_id') which was superseded by
--  current_employee_org() in 20260420010200_phase1_3_org_scoped_rls.sql.
-- ============================================================

-- ============================================================
--  RBAC (Role-Based Access Control)
-- ============================================================

create table roles (
  id serial primary key,
  name text unique not null,
  description text,
  level int default 0
);

create table permissions (
  id serial primary key,
  code text unique not null,
  name text not null,
  module text,
  description text
);

create table role_permissions (
  id serial primary key,
  role_id int references roles(id) on delete cascade,
  permission_id int references permissions(id) on delete cascade,
  unique(role_id, permission_id)
);

-- Employees
create table employees (
  id serial primary key,
  name text not null,
  name_en text,
  dept text,
  position text,
  position_secondary text,
  position_third text,
  store text,
  status text default '在職',
  email text unique,
  phone text,
  join_date date,
  avatar text,
  role_id int references roles(id),
  supervisor text,
  created_at timestamptz default now()
);

-- Attendance Records
create table attendance_records (
  id serial primary key,
  employee text not null,
  date date not null,
  clock_in time,
  clock_out time,
  status text,
  hours numeric(4,2) default 0,
  clock_in_lat double precision,
  clock_in_lng double precision,
  clock_in_ip text,
  clock_in_location text,
  clock_out_lat double precision,
  clock_out_lng double precision,
  clock_out_ip text,
  created_at timestamptz default now()
);

-- Leave Requests
create table leave_requests (
  id serial primary key,
  employee text not null,
  type text not null,
  start_date date not null,
  end_date date not null,
  days int not null,
  reason text,
  status text default '待審核',
  approver text default '-',
  reject_reason text,
  created_at timestamptz default now()
);

-- Overtime Requests
create table overtime_requests (
  id serial primary key,
  employee text not null,
  date date not null,
  hours numeric(4,1) not null,
  reason text,
  status text default '待審核',
  approver text,
  reject_reason text,
  created_at timestamptz default now()
);

-- Salary Records
create table salary_records (
  id serial primary key,
  employee text not null,
  base_salary int not null,
  allowance int default 0,
  overtime int default 0,
  deductions int default 0,
  insurance int default 0,
  net_salary int not null,
  month text not null,
  created_at timestamptz default now()
);

-- Schedule Data
create table schedule_data (
  id serial primary key,
  employee text not null,
  mon text default '休',
  tue text default '休',
  wed text default '休',
  thu text default '休',
  fri text default '休',
  sat text default '休',
  sun text default '休',
  week_start date
);

-- Holidays
create table holidays (
  id serial primary key,
  name text not null,
  date date not null,
  type text default '國定假日'
);

-- Performance Reviews
create table performance_reviews (
  id serial primary key,
  employee text not null,
  period text,
  overall_score int,
  goals int,
  goals_completed int,
  rating text,
  reviewer text,
  status text default '自評中',
  created_at timestamptz default now()
);

-- Recruitment Jobs
create table recruitment_jobs (
  id serial primary key,
  title text not null,
  dept text,
  location text,
  type text default '全職',
  applicants int default 0,
  status text default '招募中',
  posted date default current_date
);

-- Documents
create table documents (
  id serial primary key,
  name text not null,
  type text,
  size text,
  uploader text,
  upload_date date default current_date,
  category text
);

-- Business Trips
create table business_trips (
  id serial primary key,
  employee text not null,
  destination text,
  start_date date,
  end_date date,
  purpose text,
  budget int,
  status text default '待審核',
  approver text,
  reject_reason text,
  created_at timestamptz default now()
);

-- Expenses
create table expenses (
  id serial primary key,
  employee text not null,
  category text,
  amount int not null,
  date date,
  description text,
  status text default '待審核',
  approver text,
  reject_reason text,
  receipt boolean default false,
  created_at timestamptz default now()
);

-- Workflows
create table workflows (
  id serial primary key,
  name text not null,
  steps int default 1,
  active_instances int default 0,
  status text default '已啟用',
  description text,
  category text
);

-- Workflow Instances (流程實例)
CREATE TABLE IF NOT EXISTS workflow_instances (
  id SERIAL PRIMARY KEY,
  template_name TEXT NOT NULL,
  store TEXT,
  status TEXT DEFAULT '進行中',        -- 進行中, 已完成
  started_by TEXT,
  assignee TEXT,
  groups TEXT[],
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  due_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Workflow Steps (流程步驟/任務)
CREATE TABLE IF NOT EXISTS workflow_steps (
  id SERIAL PRIMARY KEY,
  instance_id INT REFERENCES workflow_instances(id) ON DELETE CASCADE,
  step_order INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  role TEXT,
  assignee TEXT,
  store TEXT,
  planned_start DATE,
  due_date DATE,
  due_time TIME DEFAULT '17:00',
  status TEXT DEFAULT '待處理',        -- 待處理, 進行中, 已完成, 已擱置
  notes TEXT,
  confirmed BOOLEAN DEFAULT false,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tasks
create table tasks (
  id serial primary key,
  title text not null,
  workflow text,
  status text default '未開始',
  assignee text,
  due_date date,
  priority text default '中',
  created_at timestamptz default now()
);

-- Checklists
create table checklists (
  id serial primary key,
  name text not null,
  items int default 0,
  completed int default 0,
  category text,
  assignee text
);

-- Companies
create table companies (
  id serial primary key,
  name text not null,
  short_name text,
  tax_id text,
  address text,
  phone text,
  stores int default 0,
  employees int default 0,
  status text default '營運中'
);

-- Stores
create table stores (
  id serial primary key,
  name text not null,
  company text,
  address text,
  phone text,
  manager text,
  employee_count int default 0,
  status text default '營運中',
  lat double precision,
  lng double precision,
  clock_radius int default 150,
  allowed_wifi text[]
);

-- Departments
create table departments (
  id serial primary key,
  name text not null,
  head text,
  member_count int default 0,
  description text
);

-- Triggers
create table triggers (
  id serial primary key,
  name text not null,
  type text,
  schedule text,
  status text default '啟用',
  last_run timestamptz,
  action text
);

-- Notifications
create table notifications (
  id serial primary key,
  type text,
  title text not null,
  read boolean default false,
  user_id text,
  created_at timestamptz default now()
);

-- Audit Logs (enhanced with field-level change tracking)
create table audit_logs (
  id serial primary key,
  "user" text not null,
  action text,
  target text,
  target_table text,
  target_id int,
  field_name text,
  old_value text,
  new_value text,
  time timestamptz default now(),
  ip text,
  organization_id int references organizations(id)
);

-- KPI Data
create table kpi_data (
  id serial primary key,
  metric text not null,
  value numeric,
  target numeric,
  unit text,
  trend text default 'stable'
);

-- ============================================================
--  採購管理 (Purchase Management)
-- ============================================================

-- Suppliers
create table suppliers (
  id serial primary key,
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  payment_terms text default 'NET30',
  rating int default 3,
  status text default '合作中',
  created_at timestamptz default now()
);

-- Purchase Requests (PR)
create table purchase_requests (
  id serial primary key,
  pr_number text unique,
  requester text,
  department text,
  items jsonb default '[]',
  total_amount numeric default 0,
  reason text,
  status text default '待審核',
  approved_by text,
  created_at timestamptz default now()
);

-- Purchase Orders (PO)
create table purchase_orders (
  id serial primary key,
  po_number text unique,
  supplier text,
  pr_id int references purchase_requests(id),
  items jsonb default '[]',
  total_amount numeric default 0,
  tax numeric default 0,
  shipping numeric default 0,
  payment_terms text,
  expected_date date,
  status text default '待確認',
  created_at timestamptz default now()
);

-- Goods Receipts (驗收)
create table goods_receipts (
  id serial primary key,
  po_id int references purchase_orders(id),
  receiver text,
  received_date date,
  items jsonb default '[]',
  notes text,
  status text default '待驗收',
  created_at timestamptz default now()
);

-- ============================================================
--  財務會計 (Finance & Accounting)
-- ============================================================

-- Chart of Accounts (會計科目)
create table accounts (
  id serial primary key,
  code text unique not null,
  name text not null,
  type text not null,
  parent_code text,
  balance numeric default 0,
  description text
);

-- Journal Entries (傳票)
create table journal_entries (
  id serial primary key,
  entry_number text unique,
  entry_date date not null,
  description text,
  source text,
  source_id int,
  status text default '草稿',
  created_by text,
  created_at timestamptz default now()
);

-- Journal Lines (傳票明細)
create table journal_lines (
  id serial primary key,
  entry_id int references journal_entries(id) on delete cascade,
  account_code text,
  account_name text,
  debit numeric default 0,
  credit numeric default 0,
  memo text
);

-- Accounts Receivable (應收帳款)
create table accounts_receivable (
  id serial primary key,
  invoice_number text unique,
  customer text,
  order_ref text,
  amount numeric not null,
  paid_amount numeric default 0,
  due_date date,
  status text default '未收款',
  created_at timestamptz default now()
);

-- Accounts Payable (應付帳款)
create table accounts_payable (
  id serial primary key,
  bill_number text unique,
  supplier text,
  po_ref text,
  amount numeric not null,
  paid_amount numeric default 0,
  due_date date,
  status text default '未付款',
  created_at timestamptz default now()
);

-- ============================================================
--  製造 & 品質 (Manufacturing & QM)
-- ============================================================

-- BOM (Bill of Materials)
create table bom (
  id serial primary key,
  product_name text not null,
  product_code text,
  version text default 'v1',
  components jsonb default '[]',
  total_cost numeric default 0,
  status text default '使用中',
  created_at timestamptz default now()
);

-- MRP Results (物料需求計畫)
create table mrp_results (
  id serial primary key,
  product_name text,
  bom_id int references bom(id),
  order_qty int,
  components jsonb default '[]',
  shortages jsonb default '[]',
  status text default '待處理',
  created_at timestamptz default now()
);

-- Quality Inspections (品質檢驗)
create table quality_inspections (
  id serial primary key,
  type text not null,
  reference text,
  reference_id int,
  inspector text,
  inspection_date date,
  items jsonb default '[]',
  pass_rate numeric default 0,
  result text default '待檢',
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
--  進階功能增強 (Enterprise Features)
-- ============================================================

-- 供應商合約管理
create table supplier_contracts (
  id serial primary key,
  supplier_id int references suppliers(id),
  contract_number text,
  start_date date,
  end_date date,
  terms text,
  min_order numeric default 0,
  discount_rate numeric default 0,
  status text default '有效',
  created_at timestamptz default now()
);

-- 預算管理
create table budgets (
  id serial primary key,
  department text,
  category text,
  period text,
  budget_amount numeric default 0,
  spent_amount numeric default 0,
  remaining numeric default 0,
  status text default '使用中',
  created_at timestamptz default now()
);

-- 銀行對帳
create table bank_transactions (
  id serial primary key,
  bank_account text,
  transaction_date date,
  description text,
  debit numeric default 0,
  credit numeric default 0,
  balance numeric default 0,
  matched boolean default false,
  matched_entry_id int,
  created_at timestamptz default now()
);

-- 製令管理 (Manufacturing Orders)
create table manufacturing_orders (
  id serial primary key,
  mo_number text unique,
  product_name text,
  bom_id int references bom(id),
  quantity int,
  start_date date,
  due_date date,
  completed_qty int default 0,
  defect_qty int default 0,
  status text default '待生產',
  priority text default '中',
  assigned_to text,
  notes text,
  created_at timestamptz default now()
);

-- 庫存批號追蹤
create table inventory_lots (
  id serial primary key,
  sku_id int,
  lot_number text,
  expiry_date date,
  quantity int default 0,
  warehouse text,
  location_code text,
  status text default '正常',
  received_date date,
  created_at timestamptz default now()
);

-- 庫存盤點作業
create table stock_counts (
  id serial primary key,
  count_date date,
  warehouse text,
  counter text,
  items jsonb default '[]',
  total_items int default 0,
  discrepancies int default 0,
  status text default '盤點中',
  notes text,
  created_at timestamptz default now()
);

-- 勞健保設定
create table insurance_settings (
  id serial primary key,
  employee text,
  labor_insurance numeric default 0,
  health_insurance numeric default 0,
  pension_rate numeric default 6,
  insured_salary numeric default 0,
  effective_date date,
  created_at timestamptz default now()
);

-- ============================================================
--  銷售與 POS (Sales & POS)
-- ============================================================

-- 報價單 (Quotations)
create table quotations (
  id serial primary key,
  quote_number text unique,
  version int default 1,
  customer text,
  contact_person text,
  items jsonb default '[]',
  subtotal numeric default 0,
  discount numeric default 0,
  tax numeric default 0,
  total numeric default 0,
  valid_until date,
  notes text,
  status text default '草稿',
  created_by text,
  converted_order_id int,
  created_at timestamptz default now()
);

-- 銷售訂單 (Sales Orders)
create table sales_orders (
  id serial primary key,
  order_number text unique,
  quote_id int references quotations(id),
  customer text,
  items jsonb default '[]',
  subtotal numeric default 0,
  discount numeric default 0,
  tax numeric default 0,
  total numeric default 0,
  payment_status text default '未付款',
  shipping_status text default '未出貨',
  credit_check text default '通過',
  notes text,
  created_by text,
  created_at timestamptz default now()
);

-- 促銷活動 (Promotions)
create table promotions (
  id serial primary key,
  name text not null,
  type text not null,
  rules jsonb default '{}',
  start_date date,
  end_date date,
  applicable_to text default '全部',
  min_amount numeric default 0,
  discount_value numeric default 0,
  discount_type text default 'percent',
  max_uses int,
  used_count int default 0,
  status text default '啟用',
  created_at timestamptz default now()
);

-- POS 交易 (POS Transactions)
create table pos_transactions (
  id serial primary key,
  transaction_number text unique,
  store text,
  cashier text,
  items jsonb default '[]',
  subtotal numeric default 0,
  discount numeric default 0,
  tax numeric default 0,
  total numeric default 0,
  payment_method text default '現金',
  payment_ref text,
  member_id text,
  points_earned int default 0,
  points_used int default 0,
  invoice_number text,
  invoice_carrier text,
  status text default '完成',
  created_at timestamptz default now()
);

-- POS 交班日結 (Shift Settlement)
create table pos_shifts (
  id serial primary key,
  store text,
  cashier text,
  shift_start timestamptz,
  shift_end timestamptz,
  opening_cash numeric default 0,
  closing_cash numeric default 0,
  expected_cash numeric default 0,
  cash_difference numeric default 0,
  total_sales numeric default 0,
  total_transactions int default 0,
  card_total numeric default 0,
  mobile_pay_total numeric default 0,
  status text default '營業中',
  notes text,
  created_at timestamptz default now()
);

-- 退貨單 (Returns)
create table returns (
  id serial primary key,
  return_number text unique,
  original_order text,
  customer text,
  items jsonb default '[]',
  total_refund numeric default 0,
  reason text,
  refund_method text default '原路退回',
  status text default '待處理',
  processed_by text,
  created_at timestamptz default now()
);

-- ============================================================
--  物流、會員、發票 (Logistics, Membership, E-Invoice)
-- ============================================================

-- 物流追蹤 (Shipment Tracking)
create table shipments (
  id serial primary key,
  shipment_number text unique,
  order_ref text,
  carrier text,
  tracking_number text,
  origin text,
  destination text,
  recipient text,
  recipient_phone text,
  items jsonb default '[]',
  estimated_date date,
  actual_date date,
  status text default '待出貨',
  timeline jsonb default '[]',
  created_at timestamptz default now()
);

-- 會員與點數 (Membership & Points)
create table members (
  id serial primary key,
  member_number text unique,
  name text not null,
  phone text,
  email text,
  level text default '一般',
  total_points int default 0,
  available_points int default 0,
  total_spent numeric default 0,
  visit_count int default 0,
  birthday date,
  join_date date default current_date,
  last_visit date,
  status text default '有效',
  created_at timestamptz default now()
);

-- 點數異動紀錄
create table point_transactions (
  id serial primary key,
  member_id int references members(id),
  type text not null,
  points int not null,
  balance int,
  reference text,
  description text,
  created_at timestamptz default now()
);

-- 推薦碼 (Referral Codes)
create table referral_codes (
  id serial primary key,
  member_id int references members(id) not null,
  code text unique not null,
  max_uses int default 10,
  bonus_points int default 200,
  status text default '有效',
  created_at timestamptz default now()
);

-- 推薦碼使用紀錄 (Referral Redemptions)
create table referral_redemptions (
  id serial primary key,
  referral_code_id int references referral_codes(id) not null,
  referrer_id int references members(id) not null,
  referee_id int references members(id) not null,
  referrer_points int not null default 200,
  referee_points int not null default 100,
  created_at timestamptz default now()
);

-- 電子發票 (E-Invoice)
create table invoices (
  id serial primary key,
  invoice_number text unique,
  invoice_date date,
  seller_tax_id text,
  buyer_tax_id text,
  buyer_name text,
  items jsonb default '[]',
  subtotal numeric default 0,
  tax numeric default 0,
  total numeric default 0,
  carrier_type text,
  carrier_id text,
  donate_code text,
  status text default '已開立',
  void_reason text,
  pos_transaction_id int,
  order_ref text,
  created_at timestamptz default now()
);

-- ============================================================
--  電商平台串接 (E-Commerce Integration)
-- ============================================================

create table ecommerce_connections (
  id serial primary key,
  platform text not null,
  api_key text,
  api_secret text,
  shop_id text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  sync_options jsonb default '{}',
  status text default '未連接',
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table ecommerce_sync_logs (
  id serial primary key,
  connection_id int references ecommerce_connections(id),
  platform text,
  sync_type text,
  records_synced int default 0,
  status text default '成功',
  error_message text,
  created_at timestamptz default now()
);

-- Inquiries (demo contact form)
create table inquiries (
  id serial primary key,
  company_name text,
  contact_name text,
  phone text,
  email text,
  company_size text,
  interested_modules text[],
  created_at timestamptz default now()
);

-- ============================================================
--  Seed Data（初始測試資料）
-- ============================================================

-- RBAC seed data — 5 roles
insert into roles (name, description, level) values
('super_admin', '超級管理員 — 全系統全權限', 200),
('admin', '管理員 — 全公司人資與系統管理', 100),
('manager', '主管 — 管理所屬部門/分店', 80),
('office_staff', '行政員工 — 後勤行政操作', 40),
('store_staff', '門市員工 — 門市基本操作', 20);

insert into permissions (code, name, module) values
('employee.view', '查看員工資料', '人資'),
('employee.view_full', '查看完整個資（手機/Email）', '人資'),
('employee.edit', '編輯員工資料', '人資'),
('leave.approve', '審核假單', '人資'),
('salary.view', '查看薪資', '人資'),
('salary.view_all', '查看全部員工薪資', '人資'),
('pr.approve', '審核採購申請', '採購'),
('po.create', '建立採購單', '採購'),
('inventory.edit', '修改庫存數量', '倉儲'),
('customer.view_full', '查看客戶完整資料', 'CRM'),
('customer.edit', '編輯客戶資料', 'CRM'),
('finance.view', '查看財務資料', '財務'),
('finance.edit', '編輯傳票', '財務'),
('system.admin', '系統管理', '系統'),
('audit.view', '查看稽核日誌', '系統');

insert into role_permissions (role_id, permission_id) values
-- super_admin gets all
(1,1),(1,2),(1,3),(1,4),(1,5),(1,6),(1,7),(1,8),(1,9),(1,10),(1,11),(1,12),(1,13),(1,14),(1,15),
-- admin: all HR + system
(2,1),(2,2),(2,3),(2,4),(2,5),(2,6),(2,14),(2,15),
-- manager: view employees, view full, approve leave, view salary
(3,1),(3,2),(3,4),(3,5),
-- office_staff: view employees, view own salary
(4,1),(4,5),
-- store_staff: view own data only
(5,1),(5,5);

insert into employees (name, name_en, dept, position, store, status, email, phone, join_date, avatar, role_id, supervisor) values
('王小明', 'Xiaoming Wang', '研發部', '資深工程師', '台北總部', '在職', 'xiaoming@company.com', '0912-345-678', '2022-03-15', '#3b82f6', 3, '劉佳玲'),
('林美麗', 'Meili Lin', '行銷部', '行銷經理', '台北總部', '在職', 'meili@company.com', '0923-456-789', '2021-08-20', '#a78bfa', 2, '劉佳玲'),
('陳大偉', 'Dawei Chen', '業務部', '業務主管', '台中分店', '在職', 'dawei@company.com', '0934-567-890', '2020-11-10', '#f472b6', 2, '劉佳玲'),
('張雅婷', 'Yating Zhang', '人資部', 'HR 專員', '台北總部', '在職', 'yating@company.com', '0945-678-901', '2023-01-05', '#34d399', 4, '劉佳玲'),
('黃志強', 'Zhiqiang Huang', '研發部', '前端工程師', '台北總部', '在職', 'zhiqiang@company.com', '0956-789-012', '2023-06-12', '#fb923c', 4, '王小明'),
('劉佳玲', 'Jialing Liu', '財務部', '財務主管', '台北總部', '在職', 'jialing@company.com', '0967-890-123', '2019-04-20', '#22d3ee', 1, null),
('吳建宏', 'Jianhong Wu', '業務部', '業務代表', '高雄分店', '在職', 'jianhong@company.com', '0978-901-234', '2024-02-14', '#f87171', 4, '陳大偉'),
('蔡心怡', 'Xinyi Cai', '客服部', '客服組長', '台中分店', '在職', 'xinyi@company.com', '0989-012-345', '2022-09-08', '#fbbf24', 3, '陳大偉'),
('鄭宇翔', 'Yuxiang Zheng', '研發部', '後端工程師', '台北總部', '離職', 'yuxiang@company.com', '0990-123-456', '2021-12-01', '#64748b', 4, '王小明');

insert into attendance_records (employee, date, clock_in, clock_out, status, hours, clock_in_lat, clock_in_lng, clock_in_ip, clock_in_location) values
('王小明', '2026-03-27', '08:52', '18:15', '正常', 8.38, 25.0408, 121.5750, '114.37.129.78', '台北總部'),
('林美麗', '2026-03-27', '09:05', '18:30', '遲到', 8.42, 25.0405, 121.5752, '114.37.129.78', '台北總部'),
('陳大偉', '2026-03-27', '08:30', '17:45', '正常', 8.25, 24.1477, 120.6736, '61.220.45.8', '台中分店'),
('張雅婷', '2026-03-27', '08:58', '18:20', '正常', 8.37, 25.0407, 121.5753, '114.37.129.78', '台北總部'),
('黃志強', '2026-03-27', '09:15', '19:00', '遲到', 8.75, 25.0500, 121.5800, '220.130.50.10', '外部位置'),
('劉佳玲', '2026-03-27', '08:45', '18:00', '正常', 8.25, 25.0406, 121.5751, '114.37.129.78', '台北總部'),
('吳建宏', '2026-03-27', null, null, '未打卡', 0, null, null, null, null),
('蔡心怡', '2026-03-27', '08:55', '18:10', '正常', 8.25, 24.1480, 120.6740, '61.220.45.12', '台中分店');

insert into leave_requests (employee, type, start_date, end_date, days, reason, status, approver) values
('王小明', '特休', '2026-04-01', '2026-04-03', 3, '家庭旅遊', '已核准', '劉佳玲'),
('林美麗', '病假', '2026-03-28', '2026-03-28', 1, '身體不適', '待審核', '-'),
('黃志強', '事假', '2026-04-05', '2026-04-05', 1, '私人事務', '待審核', '-'),
('陳大偉', '特休', '2026-03-20', '2026-03-21', 2, '個人安排', '已核准', '劉佳玲'),
('蔡心怡', '婚假', '2026-05-10', '2026-05-17', 8, '結婚', '已核准', '劉佳玲'),
('吳建宏', '公假', '2026-03-30', '2026-03-30', 1, '教育訓練', '已核准', '陳大偉');

insert into overtime_requests (employee, date, hours, reason, status) values
('王小明', '2026-03-25', 2, '專案趕工', '已核准'),
('黃志強', '2026-03-26', 3, '系統上線準備', '已核准'),
('鄭宇翔', '2026-03-24', 1.5, 'Bug 修復', '待審核');

insert into salary_records (employee, base_salary, allowance, overtime, deductions, insurance, net_salary, month) values
('王小明', 65000, 5000, 3200, 2800, 3500, 66900, '2026-03'),
('林美麗', 72000, 6000, 0, 3200, 4100, 70700, '2026-03'),
('陳大偉', 80000, 8000, 5000, 4000, 4800, 84200, '2026-03'),
('張雅婷', 52000, 3000, 0, 2200, 2800, 50000, '2026-03'),
('黃志強', 58000, 4000, 4800, 2600, 3200, 61000, '2026-03'),
('劉佳玲', 85000, 8000, 0, 4500, 5200, 83300, '2026-03'),
('吳建宏', 45000, 3000, 1600, 1800, 2400, 45400, '2026-03'),
('蔡心怡', 55000, 4000, 0, 2400, 3000, 53600, '2026-03');

insert into holidays (name, date, type) values
('兒童節', '2026-04-04', '國定假日'),
('清明節', '2026-04-05', '國定假日'),
('勞動節', '2026-05-01', '國定假日'),
('端午節', '2026-05-31', '國定假日'),
('公司週年慶', '2026-06-15', '公司假日'),
('中秋節', '2026-10-06', '國定假日');

insert into performance_reviews (employee, period, overall_score, goals, goals_completed, rating, reviewer, status) values
('王小明', '2026 Q1', 92, 4, 3, 'A', '劉佳玲', '已完成'),
('林美麗', '2026 Q1', 88, 5, 4, 'A', '劉佳玲', '已完成'),
('陳大偉', '2026 Q1', 85, 6, 5, 'B+', '劉佳玲', '評核中'),
('張雅婷', '2026 Q1', 78, 4, 3, 'B', '劉佳玲', '評核中'),
('黃志強', '2026 Q1', 95, 3, 3, 'A+', '王小明', '已完成'),
('蔡心怡', '2026 Q1', 82, 5, 3, 'B+', '陳大偉', '自評中'),
('吳建宏', '2026 Q1', 70, 4, 2, 'B-', '陳大偉', '自評中');

insert into recruitment_jobs (title, dept, location, type, applicants, status, posted) values
('資深前端工程師', '研發部', '台北總部', '全職', 12, '招募中', '2026-03-10'),
('行銷專員', '行銷部', '台北總部', '全職', 8, '招募中', '2026-03-15'),
('門市店員', '業務部', '台中分店', '兼職', 25, '已關閉', '2026-02-20'),
('AI 工程師', '研發部', '台北總部', '全職', 5, '招募中', '2026-03-20');

insert into documents (name, type, size, uploader, upload_date, category) values
('員工手冊 v3.2', 'PDF', '2.4 MB', '張雅婷', '2026-03-01', '制度規章'),
('2026 Q1 技術報告', 'PDF', '5.1 MB', '王小明', '2026-03-26', '報告'),
('保密協議範本', 'DOCX', '340 KB', '張雅婷', '2026-01-15', '合約範本'),
('出差報銷表', 'XLSX', '128 KB', '劉佳玲', '2026-02-10', '表單'),
('資安政策 2026', 'PDF', '1.8 MB', '王小明', '2026-03-05', '制度規章');

insert into business_trips (employee, destination, start_date, end_date, purpose, budget, status) values
('陳大偉', '台中', '2026-04-10', '2026-04-12', '客戶拜訪', 15000, '已核准'),
('林美麗', '東京', '2026-05-05', '2026-05-08', '展覽參訪', 80000, '待審核'),
('王小明', '新竹', '2026-03-28', '2026-03-28', '技術交流', 3000, '已核准');

insert into expenses (employee, category, amount, date, description, status, receipt) values
('陳大偉', '交通', 2800, '2026-03-20', '高鐵來回台中', '已核銷', true),
('林美麗', '住宿', 12000, '2026-03-15', '出差住宿兩晚', '待審核', true),
('王小明', '餐飲', 650, '2026-03-26', '客戶會議午餐', '已核銷', true),
('黃志強', '設備', 18500, '2026-03-22', '外接螢幕採購', '已核銷', true);

insert into workflows (name, steps, active_instances, status, description, category) values
('新人到職流程', 8, 2, '已啟用', '涵蓋帳號開通、設備領取、部門報到等流程', '人資'),
('開店流程', 45, 1, '已啟用', '依據 Google Sheet 任務清單產生（共 45 步）', '營運'),
('請假審批流程', 4, 3, '已啟用', '員工提交 → 主管審核 → HR確認 → 通知', '人資'),
('採購申請流程', 6, 0, '已啟用', '需求提出 → 報價比較 → 主管核准 → 採購 → 驗收 → 付款', '財務'),
('績效考核流程', 5, 0, '草稿', '自評 → 主管評核 → 跨部門校準 → 面談 → 結果確認', '人資');

insert into tasks (title, workflow, status, assignee, due_date, priority) values
('Step1', '開店流程', '已完成', 'Zoey', '2026-03-25', '高'),
('Step1', '開店流程', '已完成', 'Snow', '2026-03-25', '高'),
('Step2', '開店流程', '進行中', 'Snow', '2026-03-28', '中'),
('Step2', '開店流程', '未開始', 'Dave', '2026-03-30', '中'),
('Step3', '開店流程', '未開始', '學文', '2026-04-01', '低'),
('Step3', '開店流程', '已完成', 'Aska', '2026-03-26', '高'),
('Step4', '開店流程', '未開始', 'Snow', '2026-04-05', '低'),
('補貨', '日常營運', '未開始', 'Snow', '2026-03-28', '中'),
('testtask1', '測試', '已完成', 'Snow', '2026-03-20', '低');

insert into checklists (name, items, completed, category, assignee) values
('每日開店檢查', 12, 8, '門市營運', '蔡心怡'),
('新進員工報到檢核表', 15, 15, '人資', '張雅婷'),
('月底盤點清單', 20, 5, '庫存', '吳建宏'),
('設備安全檢查', 8, 0, '安全', '陳大偉');

insert into companies (name, short_name, tax_id, address, phone, stores, employees, status) values
('Master AI 科技有限公司', 'Master AI', '12345678', '台北市信義區信義路五段7號', '02-2345-6789', 3, 9, '營運中');

insert into stores (name, company, address, phone, manager, employee_count, status, lat, lng, clock_radius, allowed_wifi) values
('台北總部', 'Master AI', '台北市信義區忠孝東路五段410號', '02-2345-6789', '劉佳玲', 5, '營運中', 25.0406891, 121.5751359, 150, '{"114.37.129.0/24"}'),
('台中分店', 'Master AI', '台中市西屯區台灣大道三段99號', '04-2345-6789', '陳大偉', 2, '營運中', 24.1628, 120.6395, 150, '{"114.32.100.0/24"}'),
('高雄分店', 'Master AI', '高雄市前鎮區中華五路789號', '07-2345-6789', '吳建宏', 1, '籌備中', 22.6127, 120.3016, 150, NULL);

insert into departments (name, head, member_count, description) values
('研發部', '王小明', 3, '負責產品研發與技術創新'),
('行銷部', '林美麗', 1, '品牌推廣與市場策略'),
('業務部', '陳大偉', 2, '客戶開發與業務推展'),
('人資部', '張雅婷', 1, '人力資源管理與發展'),
('財務部', '劉佳玲', 1, '財務管理與會計作業'),
('客服部', '蔡心怡', 1, '客戶服務與售後支援');

insert into triggers (name, type, schedule, status, last_run, action) values
('每日考勤統計', '排程', '每日 00:05', '啟用', '2026-03-27 00:05:00+08', '統計前日出勤並發送報表'),
('遲到通知', '事件', '09:10 觸發', '啟用', '2026-03-27 09:10:00+08', '遲到員工發送 LINE 提醒'),
('月薪計算', '排程', '每月 25 號', '啟用', '2026-02-25 02:00:00+08', '計算當月薪資並通知財務'),
('合約到期提醒', '排程', '每週一 09:00', '停用', '2026-03-17 09:00:00+08', '提醒 HR 即將到期合約');

insert into notifications (type, title, read, created_at) values
('leave', '林美麗 提交了病假申請', false, now() - interval '10 minutes'),
('task', '「開店流程 Step2」已逾期', false, now() - interval '30 minutes'),
('system', '系統已自動產生 3 月份考勤報表', true, now() - interval '1 hour'),
('performance', '2026 Q1 績效考核已開始', true, now() - interval '2 hours'),
('hr', '蔡心怡 婚假申請已核准', true, now() - interval '1 day');

insert into audit_logs ("user", action, target, time, ip) values
('劉佳玲', '核准請假', '王小明的特休申請', '2026-03-27 10:30:00+08', '192.168.1.105'),
('張雅婷', '新增員工', '吳建宏', '2026-03-27 09:15:00+08', '192.168.1.102'),
('Snow', '更新流程', '開店流程 Step2 狀態變更', '2026-03-26 16:45:00+08', '192.168.1.110'),
('系統', '自動觸發', '每日考勤統計', '2026-03-27 00:05:00+08', '-'),
('王小明', '上傳文件', '2026 Q1 技術報告.pdf', '2026-03-26 14:20:00+08', '192.168.1.101');

insert into kpi_data (metric, value, target, unit, trend) values
('營收達成率', 94, 100, '%', 'up'),
('客戶滿意度', 4.6, 5.0, '分', 'up'),
('員工留任率', 89, 90, '%', 'stable'),
('專案交付率', 85, 95, '%', 'down'),
('品質合格率', 97, 98, '%', 'up'),
('培訓完成率', 72, 80, '%', 'up');

-- ── 採購管理 seed data ──
insert into suppliers (name, contact_person, phone, email, payment_terms, rating, status) values
('大同鋼鐵有限公司', '李文彬', '02-8765-4321', 'lee@datong.com', 'NET30', 5, '合作中'),
('永豐包裝材料行', '陳雅琪', '04-2233-4455', 'chen@yongfeng.com', 'NET15', 4, '合作中'),
('正新五金零件', '黃建華', '07-3344-5566', 'huang@zhengxin.com', 'NET45', 3, '合作中'),
('台灣物流倉儲', '張美玲', '02-5566-7788', 'chang@twlogistics.com', 'COD', 4, '暫停');

insert into purchase_requests (pr_number, requester, department, items, total_amount, reason, status, approved_by) values
('PR-2026-001', 'Snow', '業務部', '[{"name":"A4影印紙","qty":50,"unit":"箱","price":280}]', 14000, '門市用紙不足', '已核准', '劉佳玲'),
('PR-2026-002', '陳大偉', '研發部', '[{"name":"螺絲M8x30","qty":500,"unit":"個","price":2},{"name":"螺帽M8","qty":500,"unit":"個","price":1.5}]', 1750, '產線補料', '待審核', null),
('PR-2026-003', '蔡心怡', '行銷部', '[{"name":"名片印刷","qty":1000,"unit":"張","price":1.2}]', 1200, '業務名片用完', '已核准', '劉佳玲');

insert into purchase_orders (po_number, supplier, pr_id, items, total_amount, tax, shipping, payment_terms, expected_date, status) values
('PO-2026-001', '永豐包裝材料行', 1, '[{"name":"A4影印紙","qty":50,"unit":"箱","price":280}]', 14000, 700, 0, 'NET15', '2026-04-10', '已到貨'),
('PO-2026-002', '正新五金零件', 2, '[{"name":"螺絲M8x30","qty":500,"unit":"個","price":2},{"name":"螺帽M8","qty":500,"unit":"個","price":1.5}]', 1750, 88, 150, 'NET45', '2026-04-15', '待出貨');

insert into goods_receipts (po_id, receiver, received_date, items, notes, status) values
(1, 'Snow', '2026-04-02', '[{"name":"A4影印紙","qty":50,"accepted":48,"rejected":2}]', '2箱外箱破損退回', '已驗收');

-- ── 財務會計 seed data ──
insert into accounts (code, name, type, parent_code, balance) values
('1100', '現金', '資產', null, 500000),
('1200', '銀行存款', '資產', null, 3200000),
('1300', '應收帳款', '資產', null, 850000),
('2100', '應付帳款', '負債', null, 420000),
('2200', '應付薪資', '負債', null, 380000),
('3100', '業主權益', '權益', null, 2000000),
('4100', '營業收入', '收入', null, 1580000),
('5100', '營業成本', '費用', null, 620000),
('5200', '薪資費用', '費用', null, 380000),
('5300', '租金費用', '費用', null, 120000);

insert into journal_entries (entry_number, entry_date, description, source, status, created_by) values
('JE-2026-001', '2026-04-01', '4月份薪資提列', '薪資', '已過帳', '劉佳玲'),
('JE-2026-002', '2026-04-02', '採購單 PO-2026-001 入帳', '採購', '已過帳', '張雅婷'),
('JE-2026-003', '2026-04-02', '客戶貨款收款', '收款', '草稿', '蔡心怡');

insert into journal_lines (entry_id, account_code, account_name, debit, credit, memo) values
(1, '5200', '薪資費用', 380000, 0, '4月份全公司薪資'),
(1, '2200', '應付薪資', 0, 380000, '4月份全公司薪資'),
(2, '5100', '營業成本', 14700, 0, 'A4影印紙 50箱含稅'),
(2, '2100', '應付帳款', 0, 14700, '永豐包裝材料行'),
(3, '1200', '銀行存款', 150000, 0, '客戶匯款'),
(3, '1300', '應收帳款', 0, 150000, '沖銷應收');

insert into accounts_receivable (invoice_number, customer, order_ref, amount, paid_amount, due_date, status) values
('INV-2026-001', '台積電', 'SO-001', 350000, 350000, '2026-03-31', '已收款'),
('INV-2026-002', '鴻海精密', 'SO-002', 280000, 150000, '2026-04-15', '部分收款'),
('INV-2026-003', '聯發科', 'SO-003', 220000, 0, '2026-04-30', '未收款'),
('INV-2026-004', '台達電', 'SO-004', 180000, 0, '2026-05-15', '未收款');

insert into accounts_payable (bill_number, supplier, po_ref, amount, paid_amount, due_date, status) values
('BILL-2026-001', '永豐包裝材料行', 'PO-2026-001', 14700, 14700, '2026-04-17', '已付款'),
('BILL-2026-002', '正新五金零件', 'PO-2026-002', 1988, 0, '2026-05-30', '未付款'),
('BILL-2026-003', '大同鋼鐵有限公司', 'PO-2025-088', 85000, 42500, '2026-04-10', '部分付款');

-- ── 製造 & 品質 seed data ──
insert into bom (product_name, product_code, version, components, total_cost, status) values
('智慧感測器 A1', 'PROD-001', 'v2', '[{"name":"PCB 電路板","code":"MAT-001","qty":1,"unit":"片","cost":120},{"name":"溫度感測晶片","code":"MAT-002","qty":2,"unit":"顆","cost":85},{"name":"外殼 ABS","code":"MAT-003","qty":1,"unit":"個","cost":35},{"name":"螺絲M3x10","code":"MAT-004","qty":4,"unit":"個","cost":1.5}]', 331, '使用中'),
('智慧感測器 B2', 'PROD-002', 'v1', '[{"name":"PCB 電路板","code":"MAT-001","qty":1,"unit":"片","cost":120},{"name":"濕度感測晶片","code":"MAT-005","qty":1,"unit":"顆","cost":95},{"name":"外殼 ABS","code":"MAT-003","qty":1,"unit":"個","cost":35},{"name":"螺絲M3x10","code":"MAT-004","qty":6,"unit":"個","cost":1.5}]', 259, '使用中'),
('控制面板 C1', 'PROD-003', 'v1', '[{"name":"LCD 顯示器","code":"MAT-006","qty":1,"unit":"片","cost":280},{"name":"微控制器","code":"MAT-007","qty":1,"unit":"顆","cost":150},{"name":"按鈕模組","code":"MAT-008","qty":4,"unit":"個","cost":12},{"name":"機殼鋁合金","code":"MAT-009","qty":1,"unit":"個","cost":180}]', 658, '使用中');

insert into mrp_results (product_name, bom_id, order_qty, components, shortages, status) values
('智慧感測器 A1', 1, 100, '[{"name":"PCB 電路板","need":100,"stock":80,"shortage":20},{"name":"溫度感測晶片","need":200,"stock":150,"shortage":50},{"name":"外殼 ABS","need":100,"stock":200,"shortage":0},{"name":"螺絲M3x10","need":400,"stock":1000,"shortage":0}]', '[{"name":"PCB 電路板","shortage":20,"suggested_po":30},{"name":"溫度感測晶片","shortage":50,"suggested_po":75}]', '有缺料'),
('控制面板 C1', 3, 50, '[{"name":"LCD 顯示器","need":50,"stock":60,"shortage":0},{"name":"微控制器","need":50,"stock":45,"shortage":5},{"name":"按鈕模組","need":200,"stock":300,"shortage":0},{"name":"機殼鋁合金","need":50,"stock":50,"shortage":0}]', '[{"name":"微控制器","shortage":5,"suggested_po":10}]', '有缺料');

insert into quality_inspections (type, reference, inspector, inspection_date, items, pass_rate, result, notes) values
('進料檢驗', 'PO-2026-001', 'Snow', '2026-04-02', '[{"name":"A4影印紙","qty":50,"passed":48,"failed":2,"reason":"外箱破損"}]', 96, '條件通過', '2箱退回供應商'),
('成品抽檢', 'PROD-001 Batch#12', '陳大偉', '2026-04-01', '[{"name":"智慧感測器 A1","qty":20,"passed":19,"failed":1,"reason":"溫度偏差超標"}]', 95, '通過', '不良品返工'),
('成品抽檢', 'PROD-003 Batch#5', '吳建宏', '2026-03-28', '[{"name":"控制面板 C1","qty":10,"passed":10,"failed":0,"reason":""}]', 100, '通過', '全數合格');

-- ============================================================
--  Line-Item Tables (報價/訂單/發票明細行)
-- ============================================================

-- 報價單明細行 (Quotation Line Items)
create table if not exists quotation_lines (
  id serial primary key,
  quotation_id int references quotations(id) on delete cascade,
  sku_id int,
  description text,
  quantity numeric default 1,
  unit_price numeric default 0,
  discount_percent numeric default 0,
  tax_rate numeric default 0.05,
  line_total numeric generated always as (quantity * unit_price * (1 - discount_percent / 100)) stored,
  created_at timestamptz default now()
);

-- 銷售訂單明細行 (Sales Order Line Items)
create table if not exists sales_order_lines (
  id serial primary key,
  order_id int references sales_orders(id) on delete cascade,
  sku_id int,
  description text,
  quantity numeric default 1,
  unit_price numeric default 0,
  discount_percent numeric default 0,
  tax_rate numeric default 0.05,
  line_total numeric generated always as (quantity * unit_price * (1 - discount_percent / 100)) stored,
  created_at timestamptz default now()
);

-- 發票明細行 (Invoice Line Items)
create table if not exists invoice_lines (
  id serial primary key,
  invoice_id int references invoices(id) on delete cascade,
  sku_id int,
  description text,
  quantity numeric default 1,
  unit_price numeric default 0,
  discount_percent numeric default 0,
  tax_rate numeric default 0.05,
  line_total numeric generated always as (quantity * unit_price * (1 - discount_percent / 100)) stored,
  created_at timestamptz default now()
);

-- ============================================================
--  庫存成本層 (Inventory Cost Layers for FIFO tracking)
-- ============================================================
create table if not exists inventory_cost_layers (
  id serial primary key,
  sku_id int references skus(id),
  warehouse_id int references warehouses(id),
  lot_number text,
  quantity_remaining numeric default 0,
  unit_cost numeric default 0,
  receipt_date date default current_date,
  source_type text default 'purchase',  -- purchase, manufacturing, adjustment
  source_id int,
  created_at timestamptz default now()
);

-- ============================================================
--  庫存估價快照 (Inventory Valuation Snapshots)
-- ============================================================
create table if not exists inventory_valuations (
  id serial primary key,
  sku_id int references skus(id),
  valuation_date date,
  costing_method text default 'weighted_avg',  -- fifo, weighted_avg
  total_quantity numeric default 0,
  total_value numeric default 0,
  unit_cost numeric default 0,
  created_at timestamptz default now()
);

-- ============================================================
--  結構化 BOM 明細行 (Structured BOM Lines for multi-level BOM)
-- ============================================================
create table if not exists bom_lines (
  id serial primary key,
  bom_id int references bom(id) on delete cascade,
  component_sku_id int references skus(id),
  quantity numeric default 1,
  unit text default 'pcs',
  scrap_rate numeric default 0,        -- percentage waste
  is_sub_assembly boolean default false,
  sub_bom_id int references bom(id),   -- if component is itself a BOM
  created_at timestamptz default now()
);

-- ============================================================
--  多幣別支援 (Multi-Currency Support)
-- ============================================================

-- Currency definitions
CREATE TABLE IF NOT EXISTS currencies (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,       -- USD, EUR, JPY, CNY, NTD
  name TEXT NOT NULL,              -- 美元, 歐元, 日圓, 人民幣, 新台幣
  symbol TEXT DEFAULT '',
  decimal_places INT DEFAULT 2,
  is_base BOOLEAN DEFAULT false,   -- NTD is base currency
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  Message Logs (Email / SMS / LINE 發送紀錄)
-- ============================================================

CREATE TABLE IF NOT EXISTS message_logs (
  id SERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  status TEXT DEFAULT 'queued',
  campaign_id INT,
  customer_id TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Exchange rates
CREATE TABLE IF NOT EXISTS exchange_rates (
  id SERIAL PRIMARY KEY,
  from_currency TEXT NOT NULL,
  to_currency TEXT DEFAULT 'NTD',
  rate NUMERIC NOT NULL,           -- 1 USD = 31.5 NTD
  effective_date DATE NOT NULL,
  source TEXT DEFAULT 'manual',    -- manual, api
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  固定資產 (Fixed Assets Register)
-- ============================================================
CREATE TABLE IF NOT EXISTS fixed_assets (
  id SERIAL PRIMARY KEY,
  asset_code TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT DEFAULT '辦公設備',        -- 土地/建築物/��器設備/運輸設備/辦公設備/其他
  cost NUMERIC NOT NULL DEFAULT 0,
  salvage_value NUMERIC DEFAULT 0,
  useful_life INT NOT NULL DEFAULT 5,       -- years
  method TEXT DEFAULT 'straight_line',       -- straight_line/declining_balance/sum_of_years
  acquired_date DATE DEFAULT current_date,
  disposed_date DATE,
  status TEXT DEFAULT '使用中',              -- 使用中/已處分/已報廢
  department TEXT,
  location TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  成本中心 (Cost Centers)
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_centers (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  department TEXT,
  manager TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add cost_center column to journal_lines
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS cost_center TEXT;

-- Seed common currencies
INSERT INTO currencies (code, name, symbol, decimal_places, is_base) VALUES
  ('NTD', '新台幣', 'NT$', 0, true),
  ('USD', '美元', '$', 2, false),
  ('EUR', '歐元', '€', 2, false),
  ('JPY', '日圓', '¥', 0, false),
  ('CNY', '人民幣', '¥', 2, false),
  ('GBP', '英鎊', '£', 2, false),
  ('HKD', '港幣', 'HK$', 2, false)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
--  多租戶支援 (Multi-Tenancy)
-- ============================================================

-- Tenant registry
CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tax_id TEXT,
  plan TEXT DEFAULT 'free',
  max_users INT DEFAULT 5,
  admin_email TEXT,
  status TEXT DEFAULT '啟用',
  features TEXT[] DEFAULT ARRAY['HR','Finance'],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add tenant_id column to all major business tables
ALTER TABLE employees ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE overtime_requests ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE accounts_receivable ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE bom ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE manufacturing_orders ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE quality_inspections ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE inventory_lots ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE returns ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE members ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);
-- organization_id is defined in the CREATE TABLE above; no alter needed
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id);

-- ── RLS Policies (Row-Level Security) ──
-- Enable RLS on key tables. The policy uses a custom claim `tenant_id`
-- set via Supabase auth.users metadata: auth.jwt()->'app_metadata'->>'tenant_id'
-- For tables without RLS enabled yet, enable and add policy:

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  USING (organization_id::text = coalesce(current_setting('app.tenant_id', true), ''));
CREATE POLICY super_admin_audit_logs ON audit_logs AS PERMISSIVE FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      JOIN roles r ON r.id = e.role_id
      WHERE e.auth_user_id = auth.uid() AND r.name = 'super_admin'
    )
  );

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_employees ON employees
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_journal_entries ON journal_entries
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_accounts ON accounts
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_suppliers ON suppliers
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sales_orders ON sales_orders
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_purchase_orders ON purchase_orders
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_invoices ON invoices
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_fixed_assets ON fixed_assets
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_members ON members
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

ALTER TABLE pos_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pos_transactions ON pos_transactions
  USING (tenant_id::text = coalesce(current_setting('app.tenant_id', true), ''));

-- ============================================================
--  工作中心與途程 (Work Centers & Routing)
-- ============================================================
CREATE TABLE IF NOT EXISTS work_centers (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT DEFAULT '加工',              -- 加工/組裝/測試/包裝
  available_hours_per_day NUMERIC DEFAULT 8,
  efficiency_rate NUMERIC DEFAULT 100,   -- percentage
  hourly_rate NUMERIC DEFAULT 0,         -- cost per hour
  status TEXT DEFAULT '啟用',            -- 啟用/停用/維修
  notes TEXT,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routings (
  id SERIAL PRIMARY KEY,
  bom_id INT REFERENCES bom(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  work_center_id INT REFERENCES work_centers(id),
  operation_name TEXT NOT NULL,
  setup_time_min NUMERIC DEFAULT 0,      -- minutes
  run_time_min NUMERIC DEFAULT 0,        -- minutes per unit
  description TEXT,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  價格規則引擎 (Pricing Rules Engine)
-- ============================================================
CREATE TABLE IF NOT EXISTS price_lists (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT DEFAULT 'NTD',
  is_default BOOLEAN DEFAULT false,
  valid_from DATE,
  valid_to DATE,
  status TEXT DEFAULT '啟用',
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_rules (
  id SERIAL PRIMARY KEY,
  price_list_id INT REFERENCES price_lists(id) ON DELETE CASCADE,
  sku_id INT,
  customer_id INT,
  min_qty NUMERIC DEFAULT 1,
  unit_price NUMERIC NOT NULL,
  discount_percent NUMERIC DEFAULT 0,
  priority INT DEFAULT 0,               -- higher = takes precedence
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  長期採購協議 (Blanket Purchase Orders)
-- ============================================================
CREATE TABLE IF NOT EXISTS blanket_orders (
  id SERIAL PRIMARY KEY,
  bo_number TEXT UNIQUE,
  supplier_id INT REFERENCES suppliers(id),
  items JSONB DEFAULT '[]',
  total_amount NUMERIC DEFAULT 0,
  released_amount NUMERIC DEFAULT 0,
  start_date DATE,
  end_date DATE,
  payment_terms TEXT,
  status TEXT DEFAULT '有效',            -- 有效/已完成/已取消
  notes TEXT,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blanket_order_releases (
  id SERIAL PRIMARY KEY,
  blanket_order_id INT REFERENCES blanket_orders(id) ON DELETE CASCADE,
  po_id INT REFERENCES purchase_orders(id),
  release_date DATE DEFAULT current_date,
  amount NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  CRM 客戶分群 (Customer Segments)
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_segments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  rules JSONB DEFAULT '[]',              -- [{field, operator, value}]
  member_count INT DEFAULT 0,
  is_dynamic BOOLEAN DEFAULT true,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  倉庫 / 儲位管理 (Warehouse & Bin Management)
-- ============================================================
CREATE TABLE IF NOT EXISTS warehouses (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  type TEXT DEFAULT '一般',              -- 一般/冷藏/冷凍/危險品
  is_active BOOLEAN DEFAULT true,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_zones (
  id SERIAL PRIMARY KEY,
  warehouse_id INT REFERENCES warehouses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  zone_type TEXT DEFAULT '儲存',          -- 收貨/儲存/揀貨/出貨/退貨
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_bins (
  id SERIAL PRIMARY KEY,
  zone_id INT REFERENCES warehouse_zones(id) ON DELETE CASCADE,
  code TEXT NOT NULL,                     -- e.g. A-01-03 (aisle-rack-level)
  max_capacity NUMERIC DEFAULT 0,
  current_qty NUMERIC DEFAULT 0,
  sku_id INT,
  status TEXT DEFAULT '可用',             -- 可用/已滿/停用
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  通用簽核流程 (Generalized Approval Workflows)
-- ============================================================
CREATE TABLE IF NOT EXISTS approval_rules (
  id SERIAL PRIMARY KEY,
  module TEXT NOT NULL,                   -- purchase/finance/hr/wms
  document_type TEXT NOT NULL,            -- pr/po/journal_entry/leave/expense
  condition_field TEXT,                   -- e.g. total_amount
  condition_operator TEXT DEFAULT 'gte',  -- gte/lte/gt/lt/eq
  condition_value NUMERIC DEFAULT 0,
  required_role TEXT,                     -- role name required to approve
  approval_order INT DEFAULT 1,          -- step in multi-step approval
  is_active BOOLEAN DEFAULT true,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id SERIAL PRIMARY KEY,
  rule_id INT REFERENCES approval_rules(id),
  module TEXT NOT NULL,
  document_type TEXT NOT NULL,
  document_id INT NOT NULL,
  requester TEXT NOT NULL,
  approver TEXT,
  status TEXT DEFAULT '待審核',           -- 待審核/已核准/已退回
  comments TEXT,
  decided_at TIMESTAMPTZ,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  託外加工 (Subcontracting)
-- ============================================================
CREATE TABLE IF NOT EXISTS subcontracts (
  id SERIAL PRIMARY KEY,
  sc_number TEXT UNIQUE,
  supplier_id INT REFERENCES suppliers(id),
  mo_id INT REFERENCES manufacturing_orders(id),
  operation_name TEXT NOT NULL,
  items JSONB DEFAULT '[]',              -- materials issued to subcontractor
  cost NUMERIC DEFAULT 0,
  issue_date DATE DEFAULT current_date,
  expected_return_date DATE,
  actual_return_date DATE,
  status TEXT DEFAULT '已發出',           -- 已發出/加工中/已收回/已結案
  notes TEXT,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  揀貨/包裝/出貨 (Pick/Pack/Ship)
-- ============================================================
CREATE TABLE IF NOT EXISTS pick_lists (
  id SERIAL PRIMARY KEY,
  pick_number TEXT UNIQUE,
  outbound_order_id INT,
  sales_order_id INT,
  warehouse_id INT REFERENCES warehouses(id),
  picker TEXT,
  status TEXT DEFAULT '待揀貨',           -- 待揀貨/揀貨中/已完成
  items JSONB DEFAULT '[]',              -- [{sku_id, sku_code, name, qty_ordered, qty_picked, bin_code}]
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pack_lists (
  id SERIAL PRIMARY KEY,
  pack_number TEXT UNIQUE,
  pick_list_id INT REFERENCES pick_lists(id),
  packer TEXT,
  status TEXT DEFAULT '待包裝',           -- 待包裝/包裝中/已完成
  boxes JSONB DEFAULT '[]',              -- [{box_number, items: [{sku_code, qty}], weight, dimensions}]
  completed_at TIMESTAMPTZ,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  會計期間關帳 (Period Close / Year-End)
-- ============================================================
CREATE TABLE IF NOT EXISTS accounting_periods (
  id SERIAL PRIMARY KEY,
  period TEXT UNIQUE NOT NULL,            -- e.g. 2026-01, 2026-02
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT DEFAULT '開放',             -- 開放/已關帳/已重開
  closed_by TEXT,
  closed_at TIMESTAMPTZ,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  教育訓練 / LMS (Training & Learning)
-- ============================================================
CREATE TABLE IF NOT EXISTS training_courses (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT '一般',           -- 一般/安全/技術/管理/合規
  duration_hours NUMERIC DEFAULT 1,
  instructor TEXT,
  max_enrollment INT DEFAULT 30,
  status TEXT DEFAULT '開課中',           -- 開課中/已結束/草稿
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_enrollments (
  id SERIAL PRIMARY KEY,
  course_id INT REFERENCES training_courses(id) ON DELETE CASCADE,
  employee TEXT NOT NULL,
  status TEXT DEFAULT '已報名',           -- 已報名/進行中/已完成/未通過
  score NUMERIC,
  completed_at TIMESTAMPTZ,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  倉庫調撥 (Warehouse Transfers)
-- ============================================================
CREATE TABLE IF NOT EXISTS warehouse_transfers (
  id SERIAL PRIMARY KEY,
  transfer_number TEXT UNIQUE,
  from_warehouse_id INT REFERENCES warehouses(id),
  to_warehouse_id INT REFERENCES warehouses(id),
  items JSONB DEFAULT '[]',              -- [{sku_code, name, qty}]
  requested_by TEXT,
  status TEXT DEFAULT '待出庫',           -- 待出庫/運送中/已入庫/已取消
  requested_date DATE DEFAULT current_date,
  shipped_date DATE,
  received_date DATE,
  notes TEXT,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  業務佣金 (Sales Commission)
-- ============================================================
CREATE TABLE IF NOT EXISTS commission_rules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  rate_percent NUMERIC NOT NULL DEFAULT 0,
  min_amount NUMERIC DEFAULT 0,          -- minimum order amount to qualify
  product_category TEXT,                  -- null = all products
  is_active BOOLEAN DEFAULT true,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commission_records (
  id SERIAL PRIMARY KEY,
  salesperson TEXT NOT NULL,
  order_id INT REFERENCES sales_orders(id),
  order_amount NUMERIC DEFAULT 0,
  commission_rate NUMERIC DEFAULT 0,
  commission_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT '待發放',           -- 待發放/已發放/已取消
  period TEXT,                            -- e.g. 2026-04
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
--  物流追蹤整合 (Carrier Integration)
-- ============================================================
CREATE TABLE IF NOT EXISTS carrier_configs (
  id SERIAL PRIMARY KEY,
  carrier_name TEXT NOT NULL,             -- 黑貓/新竹/郵局/順豐
  api_url TEXT,
  api_key TEXT,
  is_active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed accounting periods
INSERT INTO accounting_periods (period, start_date, end_date, status) VALUES
  ('2026-01', '2026-01-01', '2026-01-31', '已關帳'),
  ('2026-02', '2026-02-01', '2026-02-28', '已關帳'),
  ('2026-03', '2026-03-01', '2026-03-31', '已關帳'),
  ('2026-04', '2026-04-01', '2026-04-30', '開放');

-- Seed training courses
INSERT INTO training_courses (title, description, category, duration_hours, instructor, status) VALUES
  ('新人到職訓練', '公司制度、系統操作、安全規範', '一般', 8, '張雅婷', '開課中'),
  ('資安意識提升', '密碼管理、社交工程防範、資料保護', '安全', 2, '王小明', '開課中'),
  ('ERP 系統操作', 'SME-OPS 各模組操作教學', '技術', 4, '劉佳玲', '開課中'),
  ('主管領導力', '團隊管理、績效面談技���', '管理', 6, '林美麗', '草稿');

INSERT INTO training_enrollments (course_id, employee, status, score) VALUES
  (1, '吳建宏', '已完成', 92),
  (1, '黃志強', '��完成', 88),
  (2, '王小明', '已完成', 95),
  (2, '林美麗', '進行中', null),
  (2, '陳大偉', '已報名', null),
  (3, '蔡心怡', '進行��', null),
  (3, '張雅婷', '已完成', 90);

-- Seed commission rules
INSERT INTO commission_rules (name, rate_percent, min_amount, is_active) VALUES
  ('標準佣金', 3, 0, true),
  ('大單佣金', 5, 100000, true),
  ('VIP 客戶佣金', 4, 50000, true);

-- Seed carrier configs
INSERT INTO carrier_configs (carrier_name, api_url, is_active) VALUES
  ('黑貓宅急便', 'https://api.t-cat.com.tw/v1', true),
  ('新竹物流', 'https://api.hct.com.tw/v1', true),
  ('中華郵政', 'https://postserv.post.gov.tw/api', false);

-- Seed warehouses
INSERT INTO warehouses (code, name, address, type) VALUES
  ('WH-TPE', '台北倉', '台北市信義區信義路五段7號B1', '一般'),
  ('WH-TXG', '台中倉', '台中市西屯區台灣大道三段99號', '一般'),
  ('WH-KHH', '高雄倉', '高雄市前鎮區中華五路789號', '一般');

INSERT INTO warehouse_zones (warehouse_id, code, name, zone_type) VALUES
  (1, 'Z-REC', '收貨區', '收貨'),
  (1, 'Z-A', 'A 儲區', '儲存'),
  (1, 'Z-B', 'B 儲區', '儲存'),
  (1, 'Z-PICK', '揀貨區', '揀貨'),
  (1, 'Z-SHIP', '出貨區', '出貨'),
  (2, 'Z-REC', '收貨區', '收貨'),
  (2, 'Z-A', 'A 儲區', '儲存'),
  (2, 'Z-SHIP', '出貨區', '出貨');

INSERT INTO warehouse_bins (zone_id, code, max_capacity, current_qty, status) VALUES
  (2, 'A-01-01', 100, 45, '可用'),
  (2, 'A-01-02', 100, 100, '已滿'),
  (2, 'A-01-03', 100, 0, '可用'),
  (2, 'A-02-01', 200, 80, '可用'),
  (2, 'A-02-02', 200, 150, '可用'),
  (3, 'B-01-01', 150, 30, '可用'),
  (3, 'B-01-02', 150, 0, '停用'),
  (7, 'A-01-01', 100, 60, '可用'),
  (7, 'A-01-02', 100, 25, '可用');

-- Seed approval rules
INSERT INTO approval_rules (module, document_type, condition_field, condition_operator, condition_value, required_role, approval_order) VALUES
  ('purchase', 'pr', 'total_amount', 'gte', 0, 'manager', 1),
  ('purchase', 'po', 'total_amount', 'gte', 50000, 'admin', 1),
  ('finance', 'journal_entry', 'total_amount', 'gte', 100000, 'admin', 1),
  ('hr', 'leave', 'days', 'gte', 0, 'team_lead', 1),
  ('hr', 'expense', 'amount', 'gte', 10000, 'manager', 1);

-- Seed work centers
INSERT INTO work_centers (code, name, type, available_hours_per_day, efficiency_rate, hourly_rate, status) VALUES
  ('WC-CNC', 'CNC 加工中心', '加工', 16, 92, 850, '啟用'),
  ('WC-PRESS', '沖壓區', '加工', 8, 87, 600, '啟用'),
  ('WC-INJ', '射出成型區', '加工', 16, 95, 750, '啟用'),
  ('WC-SMT', 'SMT 貼片線', '組裝', 8, 88, 950, '啟用'),
  ('WC-ASSY', '組裝線', '組裝', 8, 90, 500, '啟用'),
  ('WC-QC', '品質檢驗站', '測試', 8, 98, 400, '啟用'),
  ('WC-PACK', '包裝區', '包裝', 8, 95, 300, '啟用');

-- Seed routings for existing BOMs
INSERT INTO routings (bom_id, step_number, work_center_id, operation_name, setup_time_min, run_time_min) VALUES
  (1, 10, 4, 'SMT 貼片', 30, 2.5),
  (1, 20, 5, '組裝', 15, 5),
  (1, 30, 6, '功能測試', 5, 3),
  (1, 40, 7, '包裝', 5, 1),
  (2, 10, 4, 'SMT 貼片', 30, 3),
  (2, 20, 5, '組裝', 15, 4),
  (2, 30, 6, '功能測試', 5, 2.5),
  (3, 10, 1, 'CNC 機殼加工', 45, 8),
  (3, 20, 4, 'SMT 貼片', 30, 3.5),
  (3, 30, 5, '組裝', 20, 10),
  (3, 40, 6, '整機測試', 10, 5),
  (3, 50, 7, '包裝', 5, 2);

-- Seed default tenant
INSERT INTO tenants (name, slug, plan) VALUES
  ('Master AI 科技有限公司', 'master-ai', 'enterprise')
ON CONFLICT (slug) DO NOTHING;

-- ── 固定資產 seed data ──
INSERT INTO fixed_assets (asset_code, name, category, cost, salvage_value, useful_life, method, acquired_date, status, department, location) VALUES
  ('FA-001', '辦公電腦 x10', '辦公設備', 350000, 35000, 5, 'straight_line', '2024-01-15', '使用中', '研發部', '台北總部'),
  ('FA-002', '貨運卡車', '運輸設備', 1200000, 200000, 8, 'declining_balance', '2023-06-01', '使用中', '業務部', '台中分店'),
  ('FA-003', 'CNC 加工機', '機器設備', 2500000, 250000, 10, 'straight_line', '2022-03-10', '使用中', '研發部', '台北總部'),
  ('FA-004', '辦公桌椅組', '辦公設備', 180000, 18000, 7, 'sum_of_years', '2024-07-20', '使用中', '行銷部', '台北總部');

-- ── 成本中心 seed data ──
INSERT INTO cost_centers (code, name, department, manager) VALUES
  ('CC-RD', '研發中心', '研發部', '王小明'),
  ('CC-MK', '行銷中心', '行銷部', '林美麗'),
  ('CC-SA', '業務中心', '業務部', '陳大偉'),
  ('CC-FI', '財務中心', '財務部', '劉佳玲'),
  ('CC-HR', '人資中心', '人資部', '張雅婷'),
  ('CC-OH', '管理費用', null, '劉佳玲');

-- ============================================================
--  MISSING TABLES (referenced in db.js but not yet created)
-- ============================================================

-- ── SKUs (商品主檔) ──
CREATE TABLE IF NOT EXISTS skus (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  barcode TEXT,
  unit TEXT DEFAULT '件',
  category TEXT,
  weight NUMERIC(10,2),
  length NUMERIC(10,2),
  width NUMERIC(10,2),
  height NUMERIC(10,2),
  costing_method TEXT DEFAULT 'WEIGHTED_AVG',  -- FIFO, WEIGHTED_AVG, MOVING_AVG
  unit_cost NUMERIC(12,2) DEFAULT 0,
  cost NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT '啟用',
  stock_qty NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Customers (客戶主檔) ──
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  email TEXT,
  tags TEXT,
  assigned_to TEXT,
  source TEXT,
  status TEXT DEFAULT '活躍',       -- 活躍, 潛在, 冷凍, 流失
  notes TEXT,
  credit_limit NUMERIC(12,2) DEFAULT 0,
  location_id INT,
  company_id INT REFERENCES companies(id),
  company_role TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Stock Levels (庫存水位) ──
CREATE TABLE IF NOT EXISTS stock_levels (
  id SERIAL PRIMARY KEY,
  sku_code TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  quantity NUMERIC(12,2) DEFAULT 0,
  min_qty NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(sku_code, warehouse)
);

-- ── Inventory Transactions (庫存異動) ──
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL,
  date DATE NOT NULL,
  type TEXT NOT NULL,                -- IN, OUT
  qty NUMERIC(12,2) NOT NULL,
  unit_cost NUMERIC(12,2) DEFAULT 0,
  warehouse TEXT,
  reference TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Inventory Adjustments (庫存調整) ──
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id SERIAL PRIMARY KEY,
  sku_code TEXT NOT NULL,
  sku_name TEXT,
  bin_code TEXT,
  quantity NUMERIC(12,2) NOT NULL,
  reason TEXT,
  operator TEXT,
  unit_cost NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Campaigns (行銷活動) ──
CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,                          -- Email, LINE 訊息, SMS 簡訊
  segment TEXT,
  message TEXT,
  subject TEXT,
  status TEXT DEFAULT '草稿',         -- 草稿, 排程中, 發送中, 已完成, 已取消
  scheduled_at TIMESTAMPTZ,
  location_id INT,
  sent_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Vendor Categories (供應商分類) ──
CREATE TABLE IF NOT EXISTS vendor_categories (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  parent_id INT REFERENCES vendor_categories(id),
  status TEXT DEFAULT '啟用',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Vendor Performance (供應商績效) ──
CREATE TABLE IF NOT EXISTS vendor_performance (
  id SERIAL PRIMARY KEY,
  vendor_id INT REFERENCES suppliers(id),
  metric_name TEXT NOT NULL,
  value NUMERIC(10,2),
  period TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Vendor Onboarding (供應商入駐) ──
CREATE TABLE IF NOT EXISTS vendor_onboarding (
  id SERIAL PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  category TEXT,
  tax_id TEXT,
  status TEXT DEFAULT '待審核',       -- 待審核, 進行中, 已完成, 已拒絕
  checklist JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Procurement Pipeline (採購管線) ──
CREATE TABLE IF NOT EXISTS procurement_pipeline (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  stage TEXT DEFAULT '需求確認',      -- 需求確認, 供應商評估, 報價比較, 審核中, 採購下單, 交貨追蹤, 驗收完成, 已取消
  priority TEXT DEFAULT '中',         -- 緊急, 高, 中, 低
  requester TEXT,
  department TEXT,
  supplier_name TEXT,
  estimated_amount NUMERIC(12,2) DEFAULT 0,
  expected_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Procurement Workflows (採購流程範本) ──
CREATE TABLE IF NOT EXISTS procurement_workflows (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT '草稿',         -- 啟用中, 草稿, 已停用
  trigger_event TEXT,                 -- 採購申請建立, 採購單建立, 金額超過門檻
  approval_type TEXT DEFAULT '線性審批', -- 線性審批, 會簽, 或簽
  amount_threshold NUMERIC(12,2),
  steps JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Procurement Workflow Instances (採購流程實例) ──
CREATE TABLE IF NOT EXISTS procurement_workflow_instances (
  id SERIAL PRIMARY KEY,
  workflow_id INT REFERENCES procurement_workflows(id),
  reference TEXT,
  requester TEXT,
  status TEXT DEFAULT '進行中',       -- 進行中, 已完成, 已駁回, 已取消
  current_step INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════
-- Event Architecture (事件驅動架構)
-- ══════════════════════════════════════════════════════════════════

-- ── Business Events (商業事件存儲) ──
CREATE TABLE IF NOT EXISTS business_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  domain TEXT NOT NULL,
  action TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  timestamp TIMESTAMPTZ NOT NULL,
  tenant_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_events_type ON business_events(event_type);
CREATE INDEX IF NOT EXISTS idx_business_events_domain ON business_events(domain);
CREATE INDEX IF NOT EXISTS idx_business_events_tenant ON business_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_business_events_timestamp ON business_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_business_events_correlation ON business_events USING GIN ((metadata->'correlation_id'));

ALTER TABLE business_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_events ON business_events
  USING (tenant_id = current_setting('app.tenant_id', true));

-- ── Dead Letter Queue (死信佇列) ──
CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  errors JSONB NOT NULL DEFAULT '[]',
  retry_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retried_at TIMESTAMPTZ
);

-- ============================================================
--  系統日誌 (System Logs) — Super Admin 跨組織監控
-- ============================================================
CREATE TABLE IF NOT EXISTS system_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id),
  level TEXT NOT NULL DEFAULT 'info',        -- debug/info/warn
  module TEXT,                                -- HR/Finance/CRM/POS/WMS/...
  action TEXT NOT NULL,                       -- login/logout/export/import/config_change/module_access/...
  message TEXT NOT NULL,
  "user" TEXT,
  user_email TEXT,
  ip TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_logs_tenant ON system_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_system_logs_module ON system_logs(module);
CREATE INDEX IF NOT EXISTS idx_system_logs_action ON system_logs(action);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at DESC);

-- ============================================================
--  錯誤日誌 (Error Logs) — Super Admin 跨組織錯誤追蹤
-- ============================================================
CREATE TABLE IF NOT EXISTS error_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id),
  level TEXT NOT NULL DEFAULT 'error',       -- error/fatal
  module TEXT,
  error_code TEXT,                            -- e.g. DB_WRITE_FAIL, AUTH_EXPIRED, VALIDATION_ERROR
  message TEXT NOT NULL,
  stack_trace TEXT,
  component TEXT,                             -- React component or function name
  url TEXT,                                   -- page URL where error occurred
  "user" TEXT,
  user_email TEXT,
  metadata JSONB DEFAULT '{}',
  resolved BOOLEAN DEFAULT false,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_tenant ON error_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_level ON error_logs(level);
CREATE INDEX IF NOT EXISTS idx_error_logs_module ON error_logs(module);
CREATE INDEX IF NOT EXISTS idx_error_logs_resolved ON error_logs(resolved);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);

-- ============================================================
--  使用者活動日誌 (User Activity Logs)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_activity (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id),
  user_name TEXT NOT NULL,
  user_email TEXT,
  action TEXT NOT NULL,                       -- page_view/click/create/update/delete/search/export/login/logout
  module TEXT,                                -- HR/Finance/CRM/...
  page TEXT,                                  -- route path
  target TEXT,                                -- what was acted on
  detail TEXT,                                -- human-readable description
  duration_sec INT,                           -- time spent on page (if page_view)
  ip TEXT,
  device TEXT,                                -- desktop/mobile/tablet
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_tenant ON user_activity(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity(user_name);
CREATE INDEX IF NOT EXISTS idx_user_activity_action ON user_activity(action);
CREATE INDEX IF NOT EXISTS idx_user_activity_module ON user_activity(module);
CREATE INDEX IF NOT EXISTS idx_user_activity_created ON user_activity(created_at DESC);

-- ── CRM Forms ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_forms (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  fields JSONB DEFAULT '[]',
  settings JSONB DEFAULT '{}',
  style JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',          -- draft, active, archived
  submissions_count INT NOT NULL DEFAULT 0,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_form_submissions (
  id SERIAL PRIMARY KEY,
  form_id INT NOT NULL REFERENCES crm_forms(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}',
  source TEXT DEFAULT 'web',                     -- web, api, manual
  ip_address TEXT,
  tenant_id INT REFERENCES tenants(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_form_submissions_form ON crm_form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_crm_form_submissions_date ON crm_form_submissions(submitted_at DESC);

-- ── CRM Workflows (自動化工作流程) ──────────────────────────
-- ── Ticket History (工單異動紀錄) ──────────────────────────
CREATE TABLE IF NOT EXISTS ticket_history (
  id SERIAL PRIMARY KEY,
  ticket_id INT NOT NULL,
  action TEXT NOT NULL,                          -- status_changed, assigned, commented, escalated, created, merged
  old_value TEXT,
  new_value TEXT,
  comment TEXT,
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket ON ticket_history(ticket_id);

-- ── Custom SLA Policies ──────────────────────────────────
CREATE TABLE IF NOT EXISTS sla_policies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  priority TEXT,
  ticket_type TEXT,
  customer_tier TEXT,
  response_hours NUMERIC(6,1) NOT NULL,
  resolution_hours NUMERIC(6,1) NOT NULL,
  is_default BOOLEAN DEFAULT false,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── CRM Territories (銷售區域) ─────────────────────────────
CREATE TABLE IF NOT EXISTS crm_territories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,                            -- 北區, 中區, 南區, 東區
  region TEXT,
  cities TEXT[],                                 -- {'台北市','新北市','基隆市'}
  assigned_reps TEXT[],
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS territory_id INT REFERENCES crm_territories(id);

-- ── CRM Leads (線索管理) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_leads (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  email TEXT,
  source TEXT,                                   -- 官網, 展覽, 轉介, LINE, 廣告, 表單
  stage TEXT NOT NULL DEFAULT '新線索',            -- 新線索, 已聯繫, 合格, 已轉換, 不合格
  score INT DEFAULT 0,
  assigned_to TEXT,
  notes TEXT,
  tags TEXT,
  converted_customer_id INT,
  converted_deal_id INT,
  disqualify_reason TEXT,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(stage);
CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned ON crm_leads(assigned_to);

-- ── CRM Activities (活動/排程) ─────────────────────────────
CREATE TABLE IF NOT EXISTS crm_activities (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,                            -- call, meeting, task, email, follow_up
  subject TEXT NOT NULL,
  description TEXT,
  entity_type TEXT,                              -- customer, opportunity, service_ticket
  entity_id INT,
  assignee TEXT,
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'planned',         -- planned, in_progress, completed, cancelled
  duration_minutes INT,
  outcome TEXT,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_activities_entity ON crm_activities(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_assignee ON crm_activities(assignee, due_date);

-- ── CRM Notes (備註) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_notes (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,                     -- customer, opportunity, service_ticket
  entity_id INT NOT NULL,
  content TEXT,
  is_pinned BOOLEAN DEFAULT false,
  author TEXT,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_notes_entity ON crm_notes(entity_type, entity_id);

-- ── CRM Attachments (附件) ────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_attachments (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INT,
  file_type TEXT,
  storage_path TEXT NOT NULL,
  uploaded_by TEXT,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_attachments_entity ON crm_attachments(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS crm_workflows (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  trigger_event TEXT NOT NULL,                   -- contact_created, deal_won, form_submitted, etc.
  trigger_config JSONB DEFAULT '{}',
  steps JSONB DEFAULT '[]',                      -- [{id, action, config}]
  status TEXT NOT NULL DEFAULT 'draft',           -- draft, active, paused
  executions INT NOT NULL DEFAULT 0,
  tenant_id INT REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
--  GAP FEATURES: Supplier SKU Mapping, Returns, Kitting, Variants
-- ============================================================

-- ── Supplier-SKU Mappings (供應商-商品對應) ──
CREATE TABLE IF NOT EXISTS supplier_sku_mappings (
  id SERIAL PRIMARY KEY,
  sku_id INT REFERENCES skus(id) ON DELETE CASCADE,
  supplier_id INT REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_sku_code TEXT,
  lead_time_days INT DEFAULT 7,
  min_order_qty NUMERIC(12,2) DEFAULT 1,
  unit_cost NUMERIC(12,2) DEFAULT 0,
  is_preferred BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(sku_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_sku_sku ON supplier_sku_mappings(sku_id);
CREATE INDEX IF NOT EXISTS idx_supplier_sku_supplier ON supplier_sku_mappings(supplier_id);

-- ── Return Orders (退貨單) ──
CREATE TABLE IF NOT EXISTS return_orders (
  id SERIAL PRIMARY KEY,
  return_number TEXT UNIQUE NOT NULL,
  sales_order_id INT,
  customer_name TEXT,
  reason TEXT NOT NULL,               -- defective, wrong_item, customer_change, damaged, expired
  status TEXT DEFAULT '待收貨',        -- 待收貨, 已收貨, 品檢中, 已入庫, 已報廢, 已取消
  items JSONB DEFAULT '[]',           -- [{sku_code, sku_name, qty, condition, disposition}]
  inspection_result JSONB,            -- {inspector, date, notes, items: [{sku_code, pass_qty, fail_qty}]}
  warehouse TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_return_orders_status ON return_orders(status);

-- ── Kit / Bundle Definitions (組合商品) ──
CREATE TABLE IF NOT EXISTS kit_definitions (
  id SERIAL PRIMARY KEY,
  kit_sku_id INT REFERENCES skus(id) ON DELETE CASCADE,
  kit_type TEXT DEFAULT 'kit',         -- kit (固定組合), bundle (促銷組合)
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kit_components (
  id SERIAL PRIMARY KEY,
  kit_id INT REFERENCES kit_definitions(id) ON DELETE CASCADE,
  component_sku_id INT REFERENCES skus(id) ON DELETE CASCADE,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  sort_order INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_kit_components_kit ON kit_components(kit_id);

-- ── SKU Variant Support ──
ALTER TABLE skus ADD COLUMN IF NOT EXISTS parent_sku_id INT REFERENCES skus(id);
ALTER TABLE skus ADD COLUMN IF NOT EXISTS variant_attributes JSONB;
ALTER TABLE skus ADD COLUMN IF NOT EXISTS is_variant BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_skus_parent ON skus(parent_sku_id) WHERE parent_sku_id IS NOT NULL;

-- ============================================================
--  HR Analytics & People Intelligence
-- ============================================================

-- ── Attrition Risk Snapshots ──
CREATE TABLE IF NOT EXISTS attrition_risk_snapshots (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  risk_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT '低',
  factors JSONB DEFAULT '[]',
  tenure_months INT,
  avg_hours_monthly NUMERIC(6,2),
  late_count_90d INT DEFAULT 0,
  leave_count_90d INT DEFAULT 0,
  performance_score NUMERIC(5,2),
  salary_percentile NUMERIC(5,2),
  last_promotion_months INT,
  engagement_score NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attrition_employee ON attrition_risk_snapshots(employee);
CREATE INDEX IF NOT EXISTS idx_attrition_date ON attrition_risk_snapshots(snapshot_date);

-- ── Compensation Bands ──
CREATE TABLE IF NOT EXISTS compensation_bands (
  id SERIAL PRIMARY KEY,
  dept TEXT NOT NULL,
  position TEXT NOT NULL,
  band_name TEXT,
  min_salary INT NOT NULL,
  mid_salary INT NOT NULL,
  max_salary INT NOT NULL,
  currency TEXT DEFAULT 'TWD',
  effective_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comp_band_dept ON compensation_bands(dept, position);

-- ── Engagement Surveys ──
CREATE TABLE IF NOT EXISTS engagement_surveys (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT '草稿',
  start_date DATE,
  end_date DATE,
  is_anonymous BOOLEAN DEFAULT true,
  questions JSONB DEFAULT '[]',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement_responses (
  id SERIAL PRIMARY KEY,
  survey_id INT REFERENCES engagement_surveys(id) ON DELETE CASCADE,
  employee TEXT,
  dept TEXT,
  answers JSONB DEFAULT '{}',
  overall_score NUMERIC(3,1),
  submitted_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_engagement_resp_survey ON engagement_responses(survey_id);

-- ── Probation Tracking ──
CREATE TABLE IF NOT EXISTS probation_records (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT DEFAULT '試用中',
  evaluations JSONB DEFAULT '[]',
  mentor TEXT,
  notes TEXT,
  result TEXT,
  decided_at DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_probation_employee ON probation_records(employee);

-- ── Approval Delegation ──
CREATE TABLE IF NOT EXISTS approval_delegations (
  id SERIAL PRIMARY KEY,
  delegator TEXT NOT NULL,
  delegate TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  scope TEXT DEFAULT '全部',
  reason TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Tax Withholding Records (扣繳憑單) ──
CREATE TABLE IF NOT EXISTS tax_withholding_records (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  year INT NOT NULL,
  gross_salary NUMERIC(12,0) DEFAULT 0,
  taxable_income NUMERIC(12,0) DEFAULT 0,
  tax_withheld NUMERIC(12,0) DEFAULT 0,
  labor_insurance NUMERIC(10,0) DEFAULT 0,
  health_insurance NUMERIC(10,0) DEFAULT 0,
  pension_employee NUMERIC(10,0) DEFAULT 0,
  pension_employer NUMERIC(10,0) DEFAULT 0,
  bonus_total NUMERIC(12,0) DEFAULT 0,
  status TEXT DEFAULT '計算中',
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee, year)
);
CREATE INDEX IF NOT EXISTS idx_tax_wh_year ON tax_withholding_records(year);

-- ── Employee Personality Profiles ──
CREATE TABLE IF NOT EXISTS employee_personality_profiles (
  id SERIAL PRIMARY KEY,
  employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
  mbti_type TEXT,
  astrology JSONB DEFAULT '{}',
  notes TEXT,
  assessed_by TEXT,
  assessed_at DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id)
);

-- ── Employee Development Plans ──
CREATE TABLE IF NOT EXISTS employee_development_plans (
  id SERIAL PRIMARY KEY,
  employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  skill_type TEXT NOT NULL DEFAULT 'hard',
  current_level TEXT DEFAULT '基礎',
  target_level TEXT DEFAULT '中級',
  course_name TEXT,
  course_provider TEXT,
  status TEXT DEFAULT '規劃中',
  start_date DATE,
  target_date DATE,
  completed_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dev_plan_emp ON employee_development_plans(employee_id);
