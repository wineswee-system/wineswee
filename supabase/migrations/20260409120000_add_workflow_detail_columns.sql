-- Add missing columns to workflow_instances
ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS assignee TEXT;
ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS groups TEXT[];
ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS due_date DATE;

-- Add missing columns to workflow_steps
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS store TEXT;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS planned_start DATE;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS due_time TIME DEFAULT '17:00';
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT false;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS confirmed_by TEXT;
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- Enable RLS policies for new columns (already has RLS from init)
-- Allow anon full access (matching existing pattern)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workflow_instances' AND policyname = 'anon_workflow_instances') THEN
    CREATE POLICY anon_workflow_instances ON workflow_instances FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workflow_steps' AND policyname = 'anon_workflow_steps') THEN
    CREATE POLICY anon_workflow_steps ON workflow_steps FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
