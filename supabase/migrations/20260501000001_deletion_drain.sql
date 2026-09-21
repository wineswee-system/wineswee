-- deletion_drain: auditable soft-delete drain for recovery
-- When workflows, projects, tasks, or checklists are deleted,
-- the full row snapshot + all related data is captured here first.
CREATE TABLE IF NOT EXISTS public.deletion_drain (
  id              BIGSERIAL PRIMARY KEY,
  entity_type     TEXT          NOT NULL,  -- 'workflow_instance' | 'task' | 'project' | 'checklist' | 'checklist_item'
  entity_id       BIGINT        NOT NULL,
  entity_name     TEXT,
  payload         JSONB         NOT NULL,  -- snapshot of the primary row
  related_data    JSONB,                   -- nested snapshots: tasks, dependencies, comments, attachments, etc.
  deleted_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_by      TEXT          NOT NULL,
  organization_id INT,
  restored_at     TIMESTAMPTZ,
  restored_by     TEXT
);

CREATE INDEX IF NOT EXISTS idx_deletion_drain_entity   ON public.deletion_drain (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_deletion_drain_org      ON public.deletion_drain (organization_id);

CREATE INDEX IF NOT EXISTS idx_deletion_drain_deleted  ON public.deletion_drain (deleted_at DESC);

ALTER TABLE public.deletion_drain ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deletion_drain_insert" ON public.deletion_drain
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "deletion_drain_select" ON public.deletion_drain
  FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';