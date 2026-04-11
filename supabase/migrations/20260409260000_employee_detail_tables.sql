-- ══ Employee extended fields ══
ALTER TABLE employees ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS grade TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS nationality TEXT DEFAULT 'TW';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_number TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_name TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_phone TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_code TEXT DEFAULT '004';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_account TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_type TEXT DEFAULT '全職'; -- 全職, 兼職, PT, 實習
ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_end DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS weekly_hours INT DEFAULT 40;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS labor_insurance BOOLEAN DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS health_insurance BOOLEAN DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pension BOOLEAN DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS can_open BOOLEAN DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS can_close BOOLEAN DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS special_categories TEXT[] DEFAULT '{}';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS line_admin BOOLEAN DEFAULT false;

-- ══ Employee Skills (技能/證照) ══
CREATE TABLE IF NOT EXISTS employee_skills (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  level TEXT DEFAULT '基礎', -- 基礎, 中級, 進階, 專家
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ══ Employee Dependents (眷屬) ══
CREATE TABLE IF NOT EXISTS employee_dependents (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship TEXT,
  birth_date DATE,
  id_number TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ══ Employee Transfers (異動紀錄) ══
CREATE TABLE IF NOT EXISTS employee_transfers (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  transfer_date DATE NOT NULL,
  from_store TEXT,
  to_store TEXT,
  from_dept TEXT,
  to_dept TEXT,
  from_position TEXT,
  to_position TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ══ Employee Performance Reviews (績效評估) ══
CREATE TABLE IF NOT EXISTS employee_reviews (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  review_date DATE NOT NULL,
  reviewer TEXT,
  score INT, -- 1-5
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ══ Schedule Preferences (排班偏好, per employee) ══
CREATE TABLE IF NOT EXISTS employee_schedule_prefs (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  pref_type TEXT NOT NULL, -- 'preferred_off', 'preferred_shift', 'unavailable'
  day_of_week INT, -- 0=Mon, 6=Sun
  specific_date DATE,
  shift_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ══ RLS ══
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['employee_skills','employee_dependents','employee_transfers','employee_reviews','employee_schedule_prefs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'anon_' || t) THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO anon USING (true) WITH CHECK (true)', 'anon_' || t, t);
    END IF;
  END LOOP;
END $$;
