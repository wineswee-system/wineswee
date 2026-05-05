-- =============================================
-- 員工資料擴充：對齊 104 匯出的 46 欄位
-- 1. employees 加 12 個欄位（婚姻、兵役、戶籍地址、職務細項…）
-- 2. 新增 4 個子表：家庭/學歷/經歷/證照
-- 3. 擴充既有 employee_skills 欄位（加 skill_type 等）
-- 4. RLS：所有新表只允許同 org 看；admin 可改
-- =============================================

BEGIN;

-- ── 1. employees 新欄位 ──
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS marital_status     TEXT,
  ADD COLUMN IF NOT EXISTS ethnic_group       TEXT,
  ADD COLUMN IF NOT EXISTS disability_type    TEXT,
  ADD COLUMN IF NOT EXISTS military_status    TEXT,
  ADD COLUMN IF NOT EXISTS work_phone         TEXT,
  ADD COLUMN IF NOT EXISTS personal_email     TEXT,
  ADD COLUMN IF NOT EXISTS registered_address TEXT,
  ADD COLUMN IF NOT EXISTS job_category       TEXT,
  ADD COLUMN IF NOT EXISTS responsibility_type TEXT,
  ADD COLUMN IF NOT EXISTS is_direct_staff    BOOLEAN,
  ADD COLUMN IF NOT EXISTS staffing_status    TEXT,
  ADD COLUMN IF NOT EXISTS reinstatement_date DATE;

COMMENT ON COLUMN employees.work_phone        IS '公司電話 (104 匯出: 公司電話)';
COMMENT ON COLUMN employees.phone             IS '行動電話 (104 匯出: 行動電話)';
COMMENT ON COLUMN employees.email             IS '公司 email (104 匯出: 公司email)';
COMMENT ON COLUMN employees.personal_email    IS '個人 email (104 匯出: 個人email)';
COMMENT ON COLUMN employees.address           IS '通訊地址 (104 匯出: 通訊地址)';
COMMENT ON COLUMN employees.registered_address IS '戶籍地址 (104 匯出: 戶籍地址)';
COMMENT ON COLUMN employees.is_direct_staff   IS 'true=直接人員（業務/生產線）, false=間接人員（管理/支援）';

-- ── 2. 子表：家庭關係 ──
CREATE TABLE IF NOT EXISTS family_members (
  id           SERIAL PRIMARY KEY,
  employee_id  INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id INT REFERENCES organizations(id),
  name         TEXT,
  relationship TEXT,
  gender       TEXT,
  birth_date   DATE,
  occupation   TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_family_members_emp ON family_members(employee_id);

-- ── 3. 子表：學歷 ──
CREATE TABLE IF NOT EXISTS education_records (
  id           SERIAL PRIMARY KEY,
  employee_id  INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id INT REFERENCES organizations(id),
  degree       TEXT,
  school       TEXT,
  major        TEXT,
  study_start  DATE,
  study_end    DATE,
  status       TEXT,
  is_highest   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_education_records_emp ON education_records(employee_id);

-- ── 4. 子表：工作經歷 ──
CREATE TABLE IF NOT EXISTS work_experiences (
  id           SERIAL PRIMARY KEY,
  employee_id  INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id INT REFERENCES organizations(id),
  status       TEXT,
  company      TEXT,
  position     TEXT,
  start_date   DATE,
  end_date     DATE,
  description  TEXT,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_experiences_emp ON work_experiences(employee_id);

-- ── 5. 既有 employee_skills 加欄（之前只有 skill_name + level） ──
ALTER TABLE employee_skills
  ADD COLUMN IF NOT EXISTS skill_type     TEXT,
  ADD COLUMN IF NOT EXISTS proficiency    TEXT,
  ADD COLUMN IF NOT EXISTS level_value    INT,
  ADD COLUMN IF NOT EXISTS evaluated_date DATE,
  ADD COLUMN IF NOT EXISTS evaluator      TEXT,
  ADD COLUMN IF NOT EXISTS notes          TEXT;

COMMENT ON COLUMN employee_skills.skill_type IS 'language | tool | work_skill | competency';

CREATE INDEX IF NOT EXISTS idx_employee_skills_emp_type
  ON employee_skills(employee_id, skill_type);

-- ── 6. 子表：證照 ──
CREATE TABLE IF NOT EXISTS certifications (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization_id INT REFERENCES organizations(id),
  name            TEXT NOT NULL,
  issued_by       TEXT,
  issued_date     DATE,
  expiry_date     DATE,
  certificate_no  TEXT,
  attachment_url  TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_certifications_emp ON certifications(employee_id);

-- ── 7. RLS：四張新表 ──
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['family_members','education_records','work_experiences','certifications']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS "%I_read" ON %I', tbl, tbl);
    EXECUTE format($f$CREATE POLICY "%I_read" ON %I FOR SELECT USING (true)$f$, tbl, tbl);

    EXECUTE format('DROP POLICY IF EXISTS "%I_write" ON %I', tbl, tbl);
    EXECUTE format($f$
      CREATE POLICY "%I_write" ON %I FOR ALL USING (
        EXISTS (
          SELECT 1 FROM employees e
          WHERE e.auth_user_id = auth.uid()
            AND e.role IN ('super_admin','admin')
        )
      )
    $f$, tbl, tbl);
  END LOOP;
END $$;

COMMIT;
