-- Add line_user_id to employees for LINE binding
ALTER TABLE employees ADD COLUMN IF NOT EXISTS line_user_id TEXT UNIQUE;

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_employees_line_user_id ON employees(line_user_id) WHERE line_user_id IS NOT NULL;
