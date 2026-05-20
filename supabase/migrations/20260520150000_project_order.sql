-- Add project_order to allow unified execution sequence numbering
-- across workflow_instances and tasks within a project
ALTER TABLE public.workflow_instances ADD COLUMN IF NOT EXISTS project_order INT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS project_order INT;
