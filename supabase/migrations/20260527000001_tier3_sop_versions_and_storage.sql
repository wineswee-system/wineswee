-- ══════════════════════════════════════════════════════════════════
-- Tier 3 Polish — SOP Template Versioning + Storage bucket
-- Run via: supabase db push   OR   Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1. SOP Template Version snapshots
--    Written by TemplateStudio.jsx before every save (edit mode).
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sop_template_versions (
  id               BIGSERIAL PRIMARY KEY,
  template_id      BIGINT NOT NULL REFERENCES sop_templates(id) ON DELETE CASCADE,
  version_number   INTEGER NOT NULL DEFAULT 1,
  name             TEXT,
  description      TEXT,
  steps            JSONB,
  changed_by       TEXT,
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_note      TEXT
);

CREATE INDEX IF NOT EXISTS idx_sop_tpl_versions_template
  ON sop_template_versions (template_id, version_number DESC);

ALTER TABLE sop_template_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sop_template_versions_select"
  ON sop_template_versions FOR SELECT
  USING (true);

CREATE POLICY "sop_template_versions_insert"
  ON sop_template_versions FOR INSERT
  WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────
-- 2. Supabase Storage — task-attachments bucket
--    Used by TaskDiscussionTab.jsx for real file uploads.
--
--    If the INSERT below fails (Storage API SQL not supported),
--    create manually: Dashboard → Storage → New Bucket
--      Name: task-attachments   Public: ON   Max size: 10 MB
-- ─────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-attachments',
  'task-attachments',
  true,
  10485760,
  ARRAY[
    'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/zip',
    'text/plain'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "task_attach_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'task-attachments');

CREATE POLICY "task_attach_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'task-attachments');

CREATE POLICY "task_attach_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'task-attachments');
