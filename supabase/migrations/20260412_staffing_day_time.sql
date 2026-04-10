-- ══════════════════════════════════════════════════════════════
--  Staffing Requirements: Day + Time Period Support
--  Allows specifying staffing needs per day-of-week and time slot
-- ══════════════════════════════════════════════════════════════

-- Add day_of_week: NULL = all days, 0=Sun, 1=Mon ... 6=Sat
ALTER TABLE store_staffing ADD COLUMN IF NOT EXISTS day_of_week INT;

-- Add time range for time-specific staffing
ALTER TABLE store_staffing ADD COLUMN IF NOT EXISTS time_start TIME;
ALTER TABLE store_staffing ADD COLUMN IF NOT EXISTS time_end TIME;

-- Add a label for display
ALTER TABLE store_staffing ADD COLUMN IF NOT EXISTS label TEXT;

-- Update unique constraint to include day + time
-- Drop old constraint if exists, add new one
DO $$
BEGIN
  -- Try to drop old constraint
  ALTER TABLE store_staffing DROP CONSTRAINT IF EXISTS store_staffing_store_id_shift_name_skill_key;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- New unique: store + shift + day + time_start
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_staffing_unique
  ON store_staffing(store_id, COALESCE(shift_name, ''), COALESCE(day_of_week, -1), COALESCE(time_start, '00:00'));

COMMENT ON COLUMN store_staffing.day_of_week IS '0=Sun, 1=Mon, ..., 6=Sat. NULL = all days.';
COMMENT ON COLUMN store_staffing.time_start IS 'Start of time period. NULL = all day / use shift times.';
COMMENT ON COLUMN store_staffing.time_end IS 'End of time period. NULL = all day / use shift times.';
COMMENT ON COLUMN store_staffing.label IS 'Display label, e.g. "週末午班"';
