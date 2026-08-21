-- 教育訓練:含申論題的測驗需存作答 + 後台批閱。
-- 純客觀題(選擇/是非/複選)照舊自動改、不進此表;只有含申論題的測驗才寫這裡等批閱。
-- idempotent。
CREATE TABLE IF NOT EXISTS lms_quiz_submissions (
  id             bigserial PRIMARY KEY,
  enrollment_id  integer REFERENCES lms_enrollments(id) ON DELETE CASCADE,
  lesson_id      integer REFERENCES lms_lessons(id) ON DELETE CASCADE,
  course_id      integer REFERENCES lms_courses(id) ON DELETE CASCADE,
  employee_id    integer REFERENCES employees(id),
  answers        jsonb DEFAULT '[]'::jsonb,   -- 對齊題序的作答(選項index / index陣列 / 申論文字)
  grades         jsonb DEFAULT '{}'::jsonb,   -- 申論逐題給分 {題index: 分數}
  auto_points    numeric DEFAULT 0,           -- 客觀題自動得分
  total_points   numeric DEFAULT 0,           -- 全卷總配分
  score          integer,                     -- 最終百分制(批閱後才有)
  needs_review   boolean DEFAULT false,       -- 有申論題待批閱
  status         text DEFAULT 'submitted',    -- submitted / graded
  graded_by      text,
  graded_at      timestamptz,
  organization_id bigint REFERENCES organizations(id),
  created_at     timestamptz DEFAULT now(),
  UNIQUE (enrollment_id, lesson_id)
);

ALTER TABLE lms_quiz_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_quiz_submissions_all ON lms_quiz_submissions;
CREATE POLICY lms_quiz_submissions_all ON lms_quiz_submissions FOR ALL
  USING (org_visible((organization_id)::bigint))
  WITH CHECK (org_visible((organization_id)::bigint));

GRANT ALL ON lms_quiz_submissions TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE lms_quiz_submissions_id_seq TO authenticated;
