-- ── 打卡時間調整紀錄（admin 直接動刀的 audit log）─────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_clock_edits (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attendance_record_id BIGINT REFERENCES public.attendance_records(id) ON DELETE CASCADE,
  employee        TEXT,
  date            DATE,
  old_clock_in    TEXT,
  new_clock_in    TEXT,
  old_clock_out   TEXT,
  new_clock_out   TEXT,
  reason          TEXT NOT NULL,
  edited_by       TEXT,
  edited_by_id    BIGINT REFERENCES public.employees(id) ON DELETE SET NULL,
  organization_id BIGINT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.attendance_clock_edits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org staff can view clock edits" ON public.attendance_clock_edits;
CREATE POLICY "org staff can view clock edits"
  ON public.attendance_clock_edits FOR SELECT
  USING (public.is_staff());

DROP POLICY IF EXISTS "org staff can insert clock edits" ON public.attendance_clock_edits;
CREATE POLICY "org staff can insert clock edits"
  ON public.attendance_clock_edits FOR INSERT
  WITH CHECK (public.is_staff());

CREATE INDEX IF NOT EXISTS idx_ace_attendance_record ON public.attendance_clock_edits(attendance_record_id);
CREATE INDEX IF NOT EXISTS idx_ace_org ON public.attendance_clock_edits(organization_id);

GRANT SELECT, INSERT ON public.attendance_clock_edits TO authenticated;

NOTIFY pgrst, 'reload schema';
