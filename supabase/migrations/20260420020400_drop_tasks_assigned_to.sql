-- ============================================================
-- Drop unused tasks.assigned_to TEXT column (missed in Phase 3.1)
--
-- 0 rows had this set; tasks.assignee_id (FK) is the canonical assignment.
-- ============================================================

BEGIN;

-- Drop dependent views first if they reference assigned_to
DROP VIEW IF EXISTS public.v_tasks_full CASCADE;
DROP VIEW IF EXISTS public.v_tasks_expanded CASCADE;

ALTER TABLE public.tasks DROP COLUMN IF EXISTS assigned_to;

-- Recreate views without assigned_to
CREATE OR REPLACE VIEW public.v_tasks_full AS
SELECT
  t.id, t.title, t.status, t.due_date, t.priority, t.created_at,
  t.workflow_instance_id, t.workflow_step_id, t.description,
  t.store_id, t.planned_start, t.due_time,
  t.completed_at, t.updated_at, t.notes, t.sort_order, t.step_order,
  t.step_type, t.role, t.category, t.bucket, t.metadata,
  t.reminder_at, t.confirmation_required, t.confirmation_status,
  t.confirmation_requested_at, t.confirmation_responded_at, t.confirmation_notes,
  t.approval_chain_id, t.trigger_actions, t.start_conditions,
  t.assignee_id,
  s.name AS store_name,
  ae.name AS assignee_name,
  wi.template_name AS workflow_instance_name,
  wi.status AS workflow_instance_status,
  wi.store AS workflow_instance_store
FROM public.tasks t
LEFT JOIN public.workflow_instances wi ON t.workflow_instance_id = wi.id
LEFT JOIN public.stores s ON s.id = t.store_id
LEFT JOIN public.employees ae ON ae.id = t.assignee_id;

CREATE OR REPLACE VIEW public.v_tasks_expanded AS
SELECT
  t.id, t.title, t.status, t.due_date, t.priority, t.created_at,
  t.workflow_instance_id, t.workflow_step_id, t.description,
  t.store_id, t.planned_start, t.due_time,
  t.completed_at, t.updated_at, t.notes, t.sort_order, t.step_order,
  t.step_type, t.role, t.category, t.bucket, t.metadata,
  t.reminder_at, t.confirmation_required, t.confirmation_status,
  t.confirmation_requested_at, t.confirmation_responded_at, t.confirmation_notes,
  t.approval_chain_id, t.trigger_actions, t.start_conditions,
  t.assignee_id, t.project_id, t.section_id, t.parent_task_id,
  t.recurrence_rule, t.recurrence_parent_id, t.recurrence_until,
  t.last_materialized_at,
  s.name AS store_name,
  ae.name AS assignee_name,
  p.name AS project_name,
  ps.name AS section_name,
  ps.color AS section_color,
  (SELECT count(*) FROM public.task_watchers tw WHERE tw.task_id = t.id) AS watcher_count,
  (SELECT count(*) FROM public.task_comments tc WHERE tc.task_id = t.id) AS comment_count,
  (SELECT count(*) FROM public.task_attachments ta WHERE ta.task_id = t.id) AS attachment_count,
  (SELECT count(*) FROM public.task_custom_field_values v WHERE v.task_id = t.id) AS custom_field_count
FROM public.tasks t
LEFT JOIN public.projects p ON t.project_id = p.id
LEFT JOIN public.project_sections ps ON t.section_id = ps.id
LEFT JOIN public.stores s ON s.id = t.store_id
LEFT JOIN public.employees ae ON ae.id = t.assignee_id;

COMMIT;
