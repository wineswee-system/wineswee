-- ── 4-Mode Clock-In Tag ────────────────────────────────────────────────────────
-- Supersedes is_overtime / is_leave_adjustment with a single tag per end of day.
--
--   clock_in_mode / clock_out_mode ∈ {normal, overtime, leave, shift_swap, outing}
--
-- Each non-normal mode pairs with a FK to the originating request row:
--   overtime   → overtime_requests (already added in 20260527200000)
--   leave      → leave_requests
--   shift_swap → shift_swaps
--   outing     → business_trips
--
-- A mode value of 'X' on either end requires the matching FK to be set.
-- shift_swap is the only mode that **cannot** auto-create at clock-time (two-stage
-- peer + manager approval) — Edge Function rejects if FK missing.

BEGIN;

-- ── 1. New columns ────────────────────────────────────────────────────────────
-- Defensive: also add overtime_request_id + overtime_requests.attendance_record_id / source
-- in case migration 20260527200000 hasn't been applied to the target DB.

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS clock_in_mode       text    NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS clock_out_mode      text    NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS overtime_request_id integer REFERENCES public.overtime_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shift_swap_id       integer REFERENCES public.shift_swaps(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS leave_request_id    integer REFERENCES public.leave_requests(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_trip_id    integer REFERENCES public.business_trips(id)    ON DELETE SET NULL;

ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS attendance_record_id integer REFERENCES public.attendance_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source               text    NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN public.attendance_records.clock_in_mode
  IS '上班打卡模式：normal / overtime / leave / shift_swap / outing';
COMMENT ON COLUMN public.attendance_records.clock_out_mode
  IS '下班打卡模式：normal / overtime / leave / shift_swap / outing';
COMMENT ON COLUMN public.attendance_records.shift_swap_id
  IS '對應已核准的換班單（shift_swap 模式必填）';
COMMENT ON COLUMN public.attendance_records.leave_request_id
  IS '對應的請假單（leave 模式必填，可自動建立）';
COMMENT ON COLUMN public.attendance_records.business_trip_id
  IS '對應的公出/外出單（outing 模式必填，可自動建立）';

-- ── 2. Backfill from old booleans (if old columns exist) ────────────────────
-- Defensive: live DB may or may not have run the 20260527200000 / 20260528020000
-- migrations that added is_overtime / is_leave_adjustment. Skip cleanly if not.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'attendance_records' AND column_name = 'is_overtime'
  ) THEN
    EXECUTE 'UPDATE public.attendance_records
                SET clock_in_mode = ''overtime'', clock_out_mode = ''overtime''
              WHERE is_overtime = true';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'attendance_records' AND column_name = 'is_leave_adjustment'
  ) THEN
    EXECUTE 'UPDATE public.attendance_records
                SET clock_in_mode = ''leave'', clock_out_mode = ''leave''
              WHERE is_leave_adjustment = true';
  END IF;
END $$;

-- ── 3. Drop old CHECK + old boolean columns (if present) ─────────────────────

ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS chk_not_both_overtime_and_leave_adj;

ALTER TABLE public.attendance_records
  DROP COLUMN IF EXISTS is_overtime,
  DROP COLUMN IF EXISTS is_leave_adjustment;

-- ── 4. Enforce mode CHECK + mode↔FK consistency ───────────────────────────────
-- Idempotent: DROP IF EXISTS before ADD, so re-running this migration is safe
-- even if Supabase Studio committed a partial earlier attempt.

ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS chk_clock_in_mode,
  DROP CONSTRAINT IF EXISTS chk_clock_out_mode,
  DROP CONSTRAINT IF EXISTS chk_mode_overtime_fk,
  DROP CONSTRAINT IF EXISTS chk_mode_leave_fk,
  DROP CONSTRAINT IF EXISTS chk_mode_shift_swap_fk,
  DROP CONSTRAINT IF EXISTS chk_mode_outing_fk;

ALTER TABLE public.attendance_records
  ADD CONSTRAINT chk_clock_in_mode
    CHECK (clock_in_mode  IN ('normal','overtime','leave','shift_swap','outing')),
  ADD CONSTRAINT chk_clock_out_mode
    CHECK (clock_out_mode IN ('normal','overtime','leave','shift_swap','outing'));

-- mode → FK direction only (FK may legitimately remain set even if mode is normal
-- on one end and X on the other — e.g. clock_in normal, clock_out overtime).
ALTER TABLE public.attendance_records
  ADD CONSTRAINT chk_mode_overtime_fk CHECK (
    (clock_in_mode  <> 'overtime' AND clock_out_mode <> 'overtime')
    OR overtime_request_id IS NOT NULL
  ),
  ADD CONSTRAINT chk_mode_leave_fk CHECK (
    (clock_in_mode  <> 'leave' AND clock_out_mode <> 'leave')
    OR leave_request_id IS NOT NULL
  ),
  ADD CONSTRAINT chk_mode_shift_swap_fk CHECK (
    (clock_in_mode  <> 'shift_swap' AND clock_out_mode <> 'shift_swap')
    OR shift_swap_id IS NOT NULL
  ),
  ADD CONSTRAINT chk_mode_outing_fk CHECK (
    (clock_in_mode  <> 'outing' AND clock_out_mode <> 'outing')
    OR business_trip_id IS NOT NULL
  );

-- ── 5. Indexes for HR group-by-mode reports ───────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_attendance_clock_in_mode
  ON public.attendance_records(clock_in_mode) WHERE clock_in_mode <> 'normal';
CREATE INDEX IF NOT EXISTS idx_attendance_clock_out_mode
  ON public.attendance_records(clock_out_mode) WHERE clock_out_mode <> 'normal';
CREATE INDEX IF NOT EXISTS idx_attendance_leave_request
  ON public.attendance_records(leave_request_id) WHERE leave_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_shift_swap
  ON public.attendance_records(shift_swap_id) WHERE shift_swap_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_business_trip
  ON public.attendance_records(business_trip_id) WHERE business_trip_id IS NOT NULL;

COMMIT;
