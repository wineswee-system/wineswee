-- ============================================================
-- 補建 supabase-schema.sql 有定義、但從未被 migration 真正創過的表
--
-- 這些表的「schema 定義」住在 supabase-schema.sql（reference 文件），
-- 但 supabase-schema.sql 不是 migration、不會被自動 apply。
-- 結果：DB 裡其實沒這些表，但前端 / RPC 寫了它們，遇到實際 query 才爆。
--
-- 受影響：
--   - documents（公司文件）
--   - training_courses（教育訓練課程）
--   - training_enrollments（教育訓練報名）
--   - performance_reviews（績效考核）
--
-- 不受影響：
--   - performance_goals 已由 20260415000002_missing_tables.sql 創過
--   - leave_balances 已由 20260418000001_hr_core_and_line_integration.sql 創過
--   - benefit_policies 已由 20260415000001_benefit_policies.sql 創過
--
-- 使用 IF NOT EXISTS 確保冪等：若表已被任何方式建立過，這支不會重建。
-- ============================================================

-- ═══ documents ═══
CREATE TABLE IF NOT EXISTS public.documents (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT,
  size        TEXT,
  uploader    TEXT,
  upload_date DATE DEFAULT CURRENT_DATE,
  category    TEXT,
  url         TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ training_courses ═══
-- 註：tenants 表已不存在（系統改用 organizations），所以這裡用 organization_id
CREATE TABLE IF NOT EXISTS public.training_courses (
  id               SERIAL PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT,
  category         TEXT DEFAULT '一般',
  duration_hours   NUMERIC DEFAULT 1,
  instructor       TEXT,
  max_enrollment   INT DEFAULT 30,
  status           TEXT DEFAULT '開課中',
  organization_id  INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  tenant_id        INT,  -- legacy column 保留供舊程式相容（沒有 FK，純 nullable）
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_courses_status ON public.training_courses(status);

-- ═══ training_enrollments ═══
CREATE TABLE IF NOT EXISTS public.training_enrollments (
  id              SERIAL PRIMARY KEY,
  course_id       INT REFERENCES public.training_courses(id) ON DELETE CASCADE,
  employee        TEXT NOT NULL,
  status          TEXT DEFAULT '已報名',
  score           NUMERIC,
  completed_at    TIMESTAMPTZ,
  organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  tenant_id       INT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(course_id, employee)
);

CREATE INDEX IF NOT EXISTS idx_training_enrollments_emp ON public.training_enrollments(employee);

-- ═══ performance_reviews ═══
CREATE TABLE IF NOT EXISTS public.performance_reviews (
  id              SERIAL PRIMARY KEY,
  employee        TEXT NOT NULL,
  period          TEXT,
  overall_score   INT,
  goals           INT,
  goals_completed INT,
  rating          TEXT,
  reviewer        TEXT,
  status          TEXT DEFAULT '自評中',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_performance_reviews_emp ON public.performance_reviews(employee);
