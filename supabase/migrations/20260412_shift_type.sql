-- Add shift_type to shift_definitions: 'morning' or 'evening'
ALTER TABLE shift_definitions ADD COLUMN IF NOT EXISTS shift_type TEXT DEFAULT 'morning';

COMMENT ON COLUMN shift_definitions.shift_type IS 'Shift period type: morning or evening';
