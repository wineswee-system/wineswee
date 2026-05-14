-- Add human-readable formatted identifiers
-- Tasks: TK-0000001 (7 digits), Workflow instances: WF-000001 (6 digits)

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_code text GENERATED ALWAYS AS (FORMAT('TK-%07d', id)) STORED;

ALTER TABLE workflow_instances
  ADD COLUMN IF NOT EXISTS workflow_code text GENERATED ALWAYS AS (FORMAT('WF-%06d', id)) STORED;
