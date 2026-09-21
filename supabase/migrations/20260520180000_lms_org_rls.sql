-- ══════════════════════════════════════════════════════════════════
-- LMS: 加 organization_id 多租戶隔離 + 修 RLS（原本全是 USING(true)）
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE lms_courses
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_lms_courses_org ON lms_courses(organization_id);

ALTER TABLE lms_enrollments
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_lms_enrollments_org ON lms_enrollments(organization_id);

ALTER TABLE lms_certificates
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_lms_certs_org ON lms_certificates(organization_id);

-- ── lms_courses RLS ──
DROP POLICY IF EXISTS lms_courses_select ON lms_courses;
DROP POLICY IF EXISTS lms_courses_insert ON lms_courses;
DROP POLICY IF EXISTS lms_courses_update ON lms_courses;

CREATE POLICY lms_courses_select ON lms_courses FOR SELECT
  USING (organization_id = (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1));
CREATE POLICY lms_courses_insert ON lms_courses FOR INSERT
  WITH CHECK (organization_id = (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1));
CREATE POLICY lms_courses_update ON lms_courses FOR UPDATE
  USING (organization_id = (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1));

-- ── lms_sections RLS（繼承 course 的 org）──
DROP POLICY IF EXISTS lms_sections_all ON lms_sections;
CREATE POLICY lms_sections_all ON lms_sections FOR ALL
  USING (EXISTS (
    SELECT 1 FROM lms_courses c
    WHERE c.id = lms_sections.course_id
      AND c.organization_id = (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
  ));

-- ── lms_lessons RLS（繼承 course 的 org）──
DROP POLICY IF EXISTS lms_lessons_all ON lms_lessons;
CREATE POLICY lms_lessons_all ON lms_lessons FOR ALL
  USING (EXISTS (
    SELECT 1 FROM lms_courses c
    WHERE c.id = lms_lessons.course_id
      AND c.organization_id = (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
  ));

-- ── lms_enrollments RLS ──
DROP POLICY IF EXISTS lms_enrollments_all ON lms_enrollments;
CREATE POLICY lms_enrollments_all ON lms_enrollments FOR ALL
  USING (organization_id = (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1));

-- ── lms_progress RLS（繼承 enrollment 的 org）──
DROP POLICY IF EXISTS lms_progress_all ON lms_progress;
CREATE POLICY lms_progress_all ON lms_progress FOR ALL
  USING (EXISTS (
    SELECT 1 FROM lms_enrollments e
    WHERE e.id = lms_progress.enrollment_id
      AND e.organization_id = (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1)
  ));

-- ── lms_certificates RLS ──
DROP POLICY IF EXISTS lms_certificates_select ON lms_certificates;
DROP POLICY IF EXISTS lms_certificates_insert ON lms_certificates;
CREATE POLICY lms_certificates_select ON lms_certificates FOR SELECT
  USING (organization_id = (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1));
CREATE POLICY lms_certificates_insert ON lms_certificates FOR INSERT
  WITH CHECK (organization_id = (SELECT organization_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1));
