-- ============================================================
--  SME Ops System — Supabase Schema + Seed Data
--  貼到 Supabase Dashboard > SQL Editor > New Query 執行
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
  ip text
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

-- RBAC seed data
insert into roles (name, description, level) values
('admin', '系統管理員 — 最高權限', 100),
('manager', '主管 — 可審核、查看完整資料', 80),
('team_lead', '組長 — 可審核組內、有限查看', 60),
('employee', '一般員工 — 基本操作', 20),
('viewer', '訪客 — 唯讀', 10);

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
-- admin gets all
(1,1),(1,2),(1,3),(1,4),(1,5),(1,6),(1,7),(1,8),(1,9),(1,10),(1,11),(1,12),(1,13),(1,14),(1,15),
-- manager
(2,1),(2,2),(2,3),(2,4),(2,5),(2,6),(2,7),(2,8),(2,9),(2,10),(2,11),(2,12),(2,13),(2,15),
-- team_lead
(3,1),(3,2),(3,4),(3,5),(3,9),(3,10),
-- employee
(4,1),(4,5),
-- viewer
(5,1);

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

insert into attendance_records (employee, date, clock_in, clock_out, status, hours) values
('王小明', '2026-03-27', '08:52', '18:15', '正常', 8.38),
('林美麗', '2026-03-27', '09:05', '18:30', '遲到', 8.42),
('陳大偉', '2026-03-27', '08:30', '17:45', '正常', 8.25),
('張雅婷', '2026-03-27', '08:58', '18:20', '正常', 8.37),
('黃志強', '2026-03-27', '09:15', '19:00', '遲到', 8.75),
('劉佳玲', '2026-03-27', '08:45', '18:00', '正常', 8.25),
('吳建宏', '2026-03-27', null, null, '未打卡', 0),
('蔡心怡', '2026-03-27', '08:55', '18:10', '正常', 8.25);

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
('台北總部', 'Master AI', '台北市信義區信義路五段7號', '02-2345-6789', '劉佳玲', 5, '營運中', 25.0330, 121.5654, 150, '{"203.69.180.0/24","61.220.45.0/24"}'),
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
