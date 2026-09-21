-- ══════════════════════════════════════════════════════════════════
-- LMS (Learning Management System) Schema
-- ══════════════════════════════════════════════════════════════════

-- ── Courses ──
CREATE TABLE IF NOT EXISTS lms_courses (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT '一般',
  difficulty TEXT DEFAULT '初級',       -- 初級 / 中級 / 進階
  thumbnail_url TEXT,
  status TEXT DEFAULT '草稿',           -- 草稿 / 發布 / 封存
  is_required BOOLEAN DEFAULT false,
  passing_score INT DEFAULT 80,
  estimated_hours NUMERIC(4,1) DEFAULT 1.0,
  tags TEXT[] DEFAULT '{}',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lms_courses_status ON lms_courses(status);
CREATE INDEX IF NOT EXISTS idx_lms_courses_category ON lms_courses(category);

-- ── Sections (chapters within a course) ──
CREATE TABLE IF NOT EXISTS lms_sections (
  id SERIAL PRIMARY KEY,
  course_id INT REFERENCES lms_courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lms_sections_course ON lms_sections(course_id);

-- ── Lessons (content items within a section) ──
CREATE TABLE IF NOT EXISTS lms_lessons (
  id SERIAL PRIMARY KEY,
  section_id INT REFERENCES lms_sections(id) ON DELETE CASCADE,
  course_id INT REFERENCES lms_courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'text',             -- text / video / quiz
  content TEXT,                         -- markdown text or video URL
  quiz_data JSONB DEFAULT '[]',         -- [{question, options[], answer_index, explanation}]
  sort_order INT DEFAULT 0,
  duration_minutes INT DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lms_lessons_course ON lms_lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_lms_lessons_section ON lms_lessons(section_id);

-- ── Enrollments ──
CREATE TABLE IF NOT EXISTS lms_enrollments (
  id SERIAL PRIMARY KEY,
  course_id INT REFERENCES lms_courses(id) ON DELETE CASCADE,
  employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
  status TEXT DEFAULT '進行中',         -- 進行中 / 已完成 / 已放棄
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  due_date DATE,
  enrolled_by TEXT DEFAULT 'self',
  UNIQUE(course_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_lms_enrollments_employee ON lms_enrollments(employee_id);
CREATE INDEX IF NOT EXISTS idx_lms_enrollments_course ON lms_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_lms_enrollments_status ON lms_enrollments(status);

-- ── Lesson progress ──
CREATE TABLE IF NOT EXISTS lms_progress (
  id SERIAL PRIMARY KEY,
  enrollment_id INT REFERENCES lms_enrollments(id) ON DELETE CASCADE,
  lesson_id INT REFERENCES lms_lessons(id) ON DELETE CASCADE,
  completed BOOLEAN DEFAULT false,
  score INT,
  time_spent_seconds INT DEFAULT 0,
  completed_at TIMESTAMPTZ,
  UNIQUE(enrollment_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_lms_progress_enrollment ON lms_progress(enrollment_id);

-- ── Certificates ──
CREATE TABLE IF NOT EXISTS lms_certificates (
  id SERIAL PRIMARY KEY,
  enrollment_id INT REFERENCES lms_enrollments(id) ON DELETE CASCADE,
  course_id INT REFERENCES lms_courses(id) ON DELETE CASCADE,
  employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
  certificate_number TEXT UNIQUE,
  score INT,
  issued_at TIMESTAMPTZ DEFAULT now(),
  expires_at DATE
);
CREATE INDEX IF NOT EXISTS idx_lms_certs_employee ON lms_certificates(employee_id);
CREATE INDEX IF NOT EXISTS idx_lms_certs_course ON lms_certificates(course_id);

-- ── RLS Policies ──
ALTER TABLE lms_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lms_courses_select ON lms_courses;
DROP POLICY IF EXISTS lms_courses_insert ON lms_courses;
DROP POLICY IF EXISTS lms_courses_update ON lms_courses;
DROP POLICY IF EXISTS lms_sections_all ON lms_sections;
DROP POLICY IF EXISTS lms_lessons_all ON lms_lessons;
DROP POLICY IF EXISTS lms_enrollments_all ON lms_enrollments;
DROP POLICY IF EXISTS lms_progress_all ON lms_progress;
DROP POLICY IF EXISTS lms_certificates_select ON lms_certificates;
DROP POLICY IF EXISTS lms_certificates_insert ON lms_certificates;

CREATE POLICY lms_courses_select ON lms_courses FOR SELECT USING (true);
CREATE POLICY lms_courses_insert ON lms_courses FOR INSERT WITH CHECK (true);
CREATE POLICY lms_courses_update ON lms_courses FOR UPDATE USING (true);

CREATE POLICY lms_sections_all ON lms_sections FOR ALL USING (true);
CREATE POLICY lms_lessons_all ON lms_lessons FOR ALL USING (true);
CREATE POLICY lms_enrollments_all ON lms_enrollments FOR ALL USING (true);
CREATE POLICY lms_progress_all ON lms_progress FOR ALL USING (true);
CREATE POLICY lms_certificates_select ON lms_certificates FOR SELECT USING (true);
CREATE POLICY lms_certificates_insert ON lms_certificates FOR INSERT WITH CHECK (true);
