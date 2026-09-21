-- ── Leave-Adjustment Clock-In Support ────────────────────────────────────────
-- Allows employees to flag a clock-in/out as "因請假延遲/提早打卡".
-- When flagged:
--   • Late clock-in penalty is waived; status written as '請假' instead of '遲到'.
--   • Early clock-out block is bypassed.
--   • The clock time must still fall within the employee's shift / office hours
--     window (tooEarly block stays active; clocking in after shift end is
--     rejected — use overtime checkbox instead).
--   • is_overtime and is_leave_adjustment are mutually exclusive.

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS is_leave_adjustment boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.attendance_records.is_leave_adjustment
  IS '是否因請假延遲上班或提早下班（is_overtime 不得同時為 true）';

ALTER TABLE public.attendance_records
  ADD CONSTRAINT chk_not_both_overtime_and_leave_adj
    CHECK (NOT (is_overtime AND is_leave_adjustment));
