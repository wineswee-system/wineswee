-- Add year_month to store_time_slots for per-month staffing requirements
ALTER TABLE store_time_slots ADD COLUMN IF NOT EXISTS year_month TEXT;

-- Drop old unique constraint and create new one with year_month
ALTER TABLE store_time_slots DROP CONSTRAINT IF EXISTS store_time_slots_store_id_day_type_start_time_key;
CREATE UNIQUE INDEX IF NOT EXISTS store_time_slots_store_month_unique
  ON store_time_slots (store_id, day_type, start_time, COALESCE(year_month, ''));
