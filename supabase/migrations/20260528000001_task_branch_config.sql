-- ============================================================
-- Conditional branching for SOP tasks
-- Stores on_approved / on_rejected step_order targets
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS branch_config JSONB;

COMMENT ON COLUMN tasks.branch_config IS
  'Conditional routing after approval. Shape: {on_approved: step_order, on_rejected: step_order}';

CREATE INDEX IF NOT EXISTS idx_tasks_branch_config
  ON tasks USING gin(branch_config)
  WHERE branch_config IS NOT NULL;
