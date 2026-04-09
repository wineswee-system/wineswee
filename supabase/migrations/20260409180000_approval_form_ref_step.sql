-- Link approval_forms to workflow steps
ALTER TABLE approval_forms ADD COLUMN IF NOT EXISTS ref_step_id INT REFERENCES workflow_steps(id) ON DELETE SET NULL;
