-- ============================================================
-- 整合老闆系統（wine_line）HR 核心 + LINE BOT 基礎設施
-- 2026-04-18
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- SECTION 1: employees 表補欄位（從 wine_line users 表搬過來）
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS employee_number         TEXT,
  ADD COLUMN IF NOT EXISTS id_number               TEXT,
  ADD COLUMN IF NOT EXISTS birth_date              DATE,
  ADD COLUMN IF NOT EXISTS gender                  TEXT,
  ADD COLUMN IF NOT EXISTS nationality             TEXT DEFAULT 'TW',
  ADD COLUMN IF NOT EXISTS address                 TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS bank_code               TEXT,
  ADD COLUMN IF NOT EXISTS bank_account            TEXT,
  ADD COLUMN IF NOT EXISTS reporting_to            INT REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS probation_end_date      DATE,
  ADD COLUMN IF NOT EXISTS job_grade               TEXT,
  -- 勞保
  ADD COLUMN IF NOT EXISTS labor_ins_enrolled      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS labor_ins_grade         INTEGER,
  ADD COLUMN IF NOT EXISTS labor_ins_enrolled_date DATE,
  ADD COLUMN IF NOT EXISTS labor_ins_withdraw_date DATE,
  -- 健保
  ADD COLUMN IF NOT EXISTS health_ins_enrolled     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS health_ins_grade        INTEGER,
  ADD COLUMN IF NOT EXISTS health_ins_enrolled_date DATE,
  -- 勞退
  ADD COLUMN IF NOT EXISTS labor_pension_enrolled  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS labor_pension_rate      NUMERIC(4,2) DEFAULT 6.00,
  -- 管理
  ADD COLUMN IF NOT EXISTS is_manager              BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_line_manager          BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived             BOOLEAN DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_employee_number
  ON public.employees(employee_number) WHERE employee_number IS NOT NULL;

-- Backfill employee numbers (skip if already populated)
DO $$
BEGIN
  WITH numbered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY join_date NULLS LAST, id) AS rn
    FROM employees
    WHERE employee_number IS NULL AND status != '離職'
  )
  UPDATE employees SET employee_number = 'EMP-' || LPAD((numbered.rn + COALESCE((SELECT MAX(NULLIF(REGEXP_REPLACE(employee_number, '[^0-9]', '', 'g'), '')::int) FROM employees), 0))::TEXT, 3, '0')
  FROM numbered WHERE employees.id = numbered.id;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Employee numbers already populated, skipping backfill';
END $$;


-- ═══════════════════════════════════════════════════════════
-- SECTION 2: 門市 GPS 打卡設定（locations 表補欄位）
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS gps_lat          NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_lng          NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_radius_m     INTEGER DEFAULT 200,
  ADD COLUMN IF NOT EXISTS wifi_allowed_ips TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS clock_in_method  TEXT DEFAULT 'any';


-- ═══════════════════════════════════════════════════════════
-- SECTION 3: LINE 相關資料表
-- ═══════════════════════════════════════════════════════════

-- LINE 用戶（BOT 互動時建立）
CREATE TABLE IF NOT EXISTS public.line_users (
  id             SERIAL PRIMARY KEY,
  line_user_id   TEXT NOT NULL UNIQUE,
  display_name   TEXT,
  employee_id    INT REFERENCES public.employees(id) ON DELETE SET NULL,
  is_verified    BOOLEAN NOT NULL DEFAULT false,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  pending_action JSONB,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_users_line_id ON public.line_users(line_user_id);
CREATE INDEX IF NOT EXISTS idx_line_users_employee ON public.line_users(employee_id);

-- LINE 群組
CREATE TABLE IF NOT EXISTS public.line_groups (
  id            SERIAL PRIMARY KEY,
  line_group_id TEXT NOT NULL UNIQUE,
  group_name    TEXT NOT NULL,
  group_type    TEXT NOT NULL DEFAULT 'general',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  joined_at     TIMESTAMPTZ DEFAULT now(),
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_groups_line_id ON public.line_groups(line_group_id);

-- LINE 群組成員
CREATE TABLE IF NOT EXISTS public.line_group_members (
  id           SERIAL PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  group_id     TEXT NOT NULL,
  joined_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(line_user_id, group_id)
);

-- LINE 訊息記錄
CREATE TABLE IF NOT EXISTS public.line_messages (
  id           SERIAL PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  display_name TEXT,
  message_text TEXT NOT NULL,
  source_type  TEXT NOT NULL DEFAULT 'user',
  direction    TEXT NOT NULL DEFAULT 'incoming',
  group_id     TEXT,
  event_type   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_messages_user    ON public.line_messages(line_user_id);
CREATE INDEX IF NOT EXISTS idx_line_messages_group   ON public.line_messages(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_line_messages_created ON public.line_messages(created_at DESC);

-- LINE 指令記錄
CREATE TABLE IF NOT EXISTS public.line_command_logs (
  id                SERIAL PRIMARY KEY,
  line_user_id      TEXT NOT NULL,
  display_name      TEXT,
  command_matched   TEXT NOT NULL,
  raw_input         TEXT NOT NULL,
  source_type       TEXT NOT NULL DEFAULT 'user',
  group_id          TEXT,
  success           BOOLEAN NOT NULL DEFAULT true,
  error_message     TEXT,
  execution_ms      INTEGER,
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_command_logs_user ON public.line_command_logs(line_user_id);
CREATE INDEX IF NOT EXISTS idx_command_logs_cmd  ON public.line_command_logs(command_matched);

-- LINE 錯誤記錄
CREATE TABLE IF NOT EXISTS public.line_error_logs (
  id            SERIAL PRIMARY KEY,
  line_user_id  TEXT,
  source_type   TEXT,
  group_id      TEXT,
  error_type    TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack   TEXT,
  context       JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════
-- SECTION 4: 打卡記錄（GPS 支援）
-- ═══════════════════════════════════════════════════════════

-- 補充 attendance_records 欄位（GPS 打卡資訊）
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS clock_in_lat        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS clock_in_lng        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS clock_in_distance_m INTEGER,
  ADD COLUMN IF NOT EXISTS clock_in_method     TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS clock_out_time      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_late             BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_minutes        INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_hours         NUMERIC(5,2);


-- ═══════════════════════════════════════════════════════════
-- SECTION 5: 假別餘額
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.leave_balances (
  id             SERIAL PRIMARY KEY,
  employee_id    INT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  year           INTEGER NOT NULL,
  leave_type     TEXT NOT NULL,
  total_days     NUMERIC(5,1) NOT NULL DEFAULT 0,
  used_days      NUMERIC(5,1) NOT NULL DEFAULT 0,
  carry_over_days NUMERIC(5,1) NOT NULL DEFAULT 0,
  expires_at     DATE,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, year, leave_type)
);
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON public.leave_balances(employee_id);


-- ═══════════════════════════════════════════════════════════
-- SECTION 6: 薪資結構 + 薪資記錄
-- ═══════════════════════════════════════════════════════════

-- 薪資結構（底薪 + 津貼設定）
CREATE TABLE IF NOT EXISTS public.salary_structures (
  id                    SERIAL PRIMARY KEY,
  employee_id           INT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  base_salary           NUMERIC(10,2) NOT NULL DEFAULT 0,
  role_allowance        NUMERIC(10,2) NOT NULL DEFAULT 0,
  meal_allowance        NUMERIC(10,2) NOT NULL DEFAULT 0,
  transport_allowance   NUMERIC(10,2) NOT NULL DEFAULT 0,
  attendance_bonus      NUMERIC(10,2) NOT NULL DEFAULT 0,
  salary_type           VARCHAR(10) NOT NULL DEFAULT 'monthly',
  hourly_rate           NUMERIC(10,2) NOT NULL DEFAULT 0,
  health_ins_dependents INT NOT NULL DEFAULT 0,
  effective_from        DATE NOT NULL DEFAULT CURRENT_DATE,
  year_end_bonus_months NUMERIC(4,2) DEFAULT 0,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id)
);

-- 薪資發放批次
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id              SERIAL PRIMARY KEY,
  pay_period      CHAR(7) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft',
  finalized_at    TIMESTAMPTZ,
  created_by      INT REFERENCES public.employees(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 薪資記錄（每人每月）
CREATE TABLE IF NOT EXISTS public.payroll_records (
  id                      SERIAL PRIMARY KEY,
  payroll_run_id          INT REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id             INT REFERENCES public.employees(id),
  pay_period              CHAR(7) NOT NULL,
  -- 收入
  base_salary             NUMERIC(10,2) DEFAULT 0,
  role_allowance          NUMERIC(10,2) DEFAULT 0,
  meal_allowance          NUMERIC(10,2) DEFAULT 0,
  transport_allowance     NUMERIC(10,2) DEFAULT 0,
  attendance_bonus_earned NUMERIC(10,2) DEFAULT 0,
  overtime_pay            NUMERIC(10,2) DEFAULT 0,
  ot_hours_weekday        NUMERIC(5,2)  DEFAULT 0,
  ot_hours_holiday        NUMERIC(5,2)  DEFAULT 0,
  other_bonus             NUMERIC(10,2) DEFAULT 0,
  year_end_bonus          NUMERIC(10,2) DEFAULT 0,
  gross_salary            NUMERIC(10,2) DEFAULT 0,
  -- 扣除
  leave_deduction         NUMERIC(10,2) DEFAULT 0,
  leave_days_deducted     NUMERIC(4,1)  DEFAULT 0,
  late_deduction          NUMERIC(10,2) DEFAULT 0,
  late_minutes            INTEGER       DEFAULT 0,
  labor_ins_employee      NUMERIC(10,2) DEFAULT 0,
  health_ins_employee     NUMERIC(10,2) DEFAULT 0,
  labor_pension_employee  NUMERIC(10,2) DEFAULT 0,
  income_tax_withheld     NUMERIC(10,2) DEFAULT 0,
  total_deductions        NUMERIC(10,2) DEFAULT 0,
  -- 雇主負擔
  labor_ins_employer      NUMERIC(10,2) DEFAULT 0,
  health_ins_employer     NUMERIC(10,2) DEFAULT 0,
  labor_pension_employer  NUMERIC(10,2) DEFAULT 0,
  -- 實發
  net_salary              NUMERIC(10,2) DEFAULT 0,
  hours_worked            NUMERIC(6,2)  DEFAULT 0,
  payslip_sent_at         TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payroll_records_run ON public.payroll_records(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_records_emp ON public.payroll_records(employee_id, pay_period);


-- ═══════════════════════════════════════════════════════════
-- SECTION 7: 勞健保級距表
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.labor_ins_brackets (
  year             INT NOT NULL,
  grade            INT NOT NULL,
  min_salary       NUMERIC(10,2) NOT NULL,
  insured_salary   NUMERIC(10,2) NOT NULL,
  employee_premium NUMERIC(10,2) NOT NULL,
  employer_premium NUMERIC(10,2) NOT NULL,
  PRIMARY KEY (year, grade)
);

CREATE TABLE IF NOT EXISTS public.health_ins_brackets (
  year             INT NOT NULL,
  grade            INT NOT NULL,
  min_salary       NUMERIC(10,2) NOT NULL,
  insured_salary   NUMERIC(10,2) NOT NULL,
  employee_premium NUMERIC(10,2) NOT NULL,
  employer_premium NUMERIC(10,2) NOT NULL,
  PRIMARY KEY (year, grade)
);


-- ═══════════════════════════════════════════════════════════
-- SECTION 8: 審核鏈
-- ═══════════════════════════════════════════════════════════

-- approval_chains: 只在不存在時建立（已有的話跳過）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'approval_chains' AND table_schema = 'public') THEN
    CREATE TABLE public.approval_chains (
      id            SERIAL PRIMARY KEY,
      module        TEXT NOT NULL,
      level         INTEGER NOT NULL DEFAULT 1,
      approver_role TEXT NOT NULL,
      min_days      NUMERIC(5,2),
      min_amount    NUMERIC(12,2),
      created_at    TIMESTAMPTZ DEFAULT now(),
      UNIQUE(module, level)
    );
    INSERT INTO public.approval_chains (module, level, approver_role, min_days) VALUES
      ('leave', 1, 'manager', NULL),
      ('leave', 2, 'admin', 3),
      ('overtime', 1, 'manager', NULL);
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════
-- SECTION 9: RLS 政策（LINE 表開放 service_role）
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.line_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_line_users" ON public.line_users FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.line_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_line_groups" ON public.line_groups FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.line_group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_line_group_members" ON public.line_group_members FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.line_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_line_messages" ON public.line_messages FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.line_command_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_line_command_logs" ON public.line_command_logs FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.line_error_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_line_error_logs" ON public.line_error_logs FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_leave_balances" ON public.leave_balances FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.salary_structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_salary_structures" ON public.salary_structures FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_payroll_runs" ON public.payroll_runs FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_payroll_records" ON public.payroll_records FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.labor_ins_brackets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_labor_ins_brackets" ON public.labor_ins_brackets FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.health_ins_brackets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_health_ins_brackets" ON public.health_ins_brackets FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.approval_chains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_approval_chains" ON public.approval_chains FOR ALL USING (true) WITH CHECK (true);

COMMIT;
