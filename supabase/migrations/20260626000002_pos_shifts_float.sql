-- Add cash float tracking columns to pos_shifts.
-- opening_float: cash placed in drawer at shift start
-- closing_cash:  cash counted at shift end (staff input)
-- variance = closing_cash - (opening_float + sum of cash payments)

ALTER TABLE pos_shifts
  ADD COLUMN IF NOT EXISTS opening_float NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closing_cash  NUMERIC(10,2);
