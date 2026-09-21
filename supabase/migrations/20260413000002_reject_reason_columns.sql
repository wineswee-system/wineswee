-- Add reject_reason column to approval-related tables
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE overtime_requests ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE overtime_requests ADD COLUMN IF NOT EXISTS approver TEXT;
ALTER TABLE business_trips ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE business_trips ADD COLUMN IF NOT EXISTS approver TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approver TEXT;
