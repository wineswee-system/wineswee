-- Add human-readable formatted identifiers
-- Tasks: TK-0000001 (7 digits), Workflow instances: WF-000001 (6 digits)
--
-- 註：原本用 format('TK-%07d', id) 會 fail，
-- 因為 Postgres format() 不是 IMMUTABLE，GENERATED ALWAYS AS STORED 不允許。
-- 改用 lpad 來達成同樣效果且符合 IMMUTABLE 要求。

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_code text GENERATED ALWAYS AS ('TK-' || lpad(id::text, 7, '0')) STORED;

ALTER TABLE workflow_instances
  ADD COLUMN IF NOT EXISTS workflow_code text GENERATED ALWAYS AS ('WF-' || lpad(id::text, 6, '0')) STORED;
