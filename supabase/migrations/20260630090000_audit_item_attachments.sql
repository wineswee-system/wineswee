-- store_audit_items 加附件欄位（JSONB URL 陣列）
ALTER TABLE public.store_audit_items
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';

-- audit-photos Storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audit-photos', 'audit-photos', true,
  10485760,  -- 10 MB per file
  ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'audit-photos-insert'
  ) THEN
    CREATE POLICY "audit-photos-insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'audit-photos');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'audit-photos-select'
  ) THEN
    CREATE POLICY "audit-photos-select" ON storage.objects
      FOR SELECT USING (bucket_id = 'audit-photos');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'audit-photos-delete'
  ) THEN
    CREATE POLICY "audit-photos-delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'audit-photos');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
