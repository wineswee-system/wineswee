-- ══════════════════════════════════════════════════════════════
--  Monthly Schedule Enhancements
--  Adds absence types, cross-store tracking, and monthly grouping
-- ══════════════════════════════════════════════════════════════

-- 1. Add absence_type to schedules for richer leave model
--    Values: NULL (working), '休', '補休', '病', '特休', '會議', '產'
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS absence_type TEXT;

-- 2. Add source_store for cross-store employee borrowing
--    Records the employee's home store when they are "borrowed"
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS source_store TEXT;

-- 3. Add month_group for monthly scheduling batch tracking
--    Format: 'YYYY-MM'
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS month_group TEXT;

-- 4. Indexes for monthly queries
CREATE INDEX IF NOT EXISTS idx_schedules_month_group ON schedules(month_group);
CREATE INDEX IF NOT EXISTS idx_schedules_date_employee ON schedules(date, employee);
CREATE INDEX IF NOT EXISTS idx_schedules_absence_type ON schedules(absence_type) WHERE absence_type IS NOT NULL;

-- 5. Backfill: existing '休' entries get absence_type = '休'
UPDATE schedules SET absence_type = '休' WHERE shift = '休' AND absence_type IS NULL;

-- 6. Backfill: set month_group for existing records
UPDATE schedules SET month_group = TO_CHAR(date, 'YYYY-MM') WHERE month_group IS NULL;

-- 7. Add comment for documentation
COMMENT ON COLUMN schedules.absence_type IS 'Absence type: 休(rest), 補休(comp), 病(sick), 特休(annual), 會議(meeting), 產(maternity). NULL = working shift.';
COMMENT ON COLUMN schedules.source_store IS 'Employee home store when borrowed for cross-store assignment.';
COMMENT ON COLUMN schedules.month_group IS 'YYYY-MM grouping for monthly schedule batches.';
