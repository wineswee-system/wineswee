-- Align pos_shifts with HR employee & schedule tables
-- 1. Replace UUID employee_id with INT FK to employees.id
-- 2. Add employee_name (denormalized, avoids joins for display)
-- 3. Add scheduled_shift_id link to HR schedules table
-- 4. Add source + pos_shift_id to attendance_records for two-way sync

-- pos_shifts: drop mismatched UUID column, add INT FK + HR schedule link
ALTER TABLE pos_shifts DROP COLUMN IF EXISTS employee_id;
ALTER TABLE pos_shifts
  ADD COLUMN IF NOT EXISTS employee_id         INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employee_name       TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_shift_id  INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS schedule_warning    TEXT;  -- 'not_scheduled' | 'on_leave' | null

CREATE INDEX IF NOT EXISTS idx_pos_shifts_employee  ON pos_shifts(employee_id);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_date      ON pos_shifts(shift_start);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_scheduled ON pos_shifts(scheduled_shift_id);

-- attendance_records: add columns so POS shift open/close can write clock-in/out
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS source       TEXT,       -- 'pos_shift' | 'clock_in_app' | null
  ADD COLUMN IF NOT EXISTS pos_shift_id TEXT;       -- pos_shifts.id for cross-reference

CREATE INDEX IF NOT EXISTS idx_attendance_pos_shift ON attendance_records(pos_shift_id);
