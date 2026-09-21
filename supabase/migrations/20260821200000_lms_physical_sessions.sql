-- 教育訓練:實體課 + 現場簽到。
-- 課程分「線上/實體」;實體課有場次(時間/地點),簽到記錄誰到場。idempotent。
ALTER TABLE lms_courses ADD COLUMN IF NOT EXISTS delivery_mode text DEFAULT '線上'; -- '線上' | '實體'

CREATE TABLE IF NOT EXISTS lms_sessions (
  id              bigserial PRIMARY KEY,
  course_id       integer REFERENCES lms_courses(id) ON DELETE CASCADE,
  title           text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  location        text,
  capacity        integer,
  organization_id bigint REFERENCES organizations(id),
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE lms_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_sessions_all ON lms_sessions;
CREATE POLICY lms_sessions_all ON lms_sessions FOR ALL
  USING (org_visible((organization_id)::bigint)) WITH CHECK (org_visible((organization_id)::bigint));
GRANT ALL ON lms_sessions TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE lms_sessions_id_seq TO authenticated;

CREATE TABLE IF NOT EXISTS lms_attendance (
  id              bigserial PRIMARY KEY,
  session_id      bigint  REFERENCES lms_sessions(id) ON DELETE CASCADE,
  course_id       integer REFERENCES lms_courses(id) ON DELETE CASCADE,
  enrollment_id   integer REFERENCES lms_enrollments(id) ON DELETE CASCADE,
  employee_id     integer REFERENCES employees(id),
  checked_in_at   timestamptz DEFAULT now(),
  checked_in_by   text DEFAULT 'admin',   -- 'self' | 'admin'
  organization_id bigint REFERENCES organizations(id),
  UNIQUE (session_id, employee_id)
);
ALTER TABLE lms_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_attendance_all ON lms_attendance;
CREATE POLICY lms_attendance_all ON lms_attendance FOR ALL
  USING (org_visible((organization_id)::bigint)) WITH CHECK (org_visible((organization_id)::bigint));
GRANT ALL ON lms_attendance TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE lms_attendance_id_seq TO authenticated;
