-- Add day_type to shift_definitions: weekday / weekend / all
ALTER TABLE shift_definitions ADD COLUMN IF NOT EXISTS day_type TEXT DEFAULT 'all';

COMMENT ON COLUMN shift_definitions.day_type IS 'Shift applicable day type: all=every day, weekday=平日, weekend=假日';
