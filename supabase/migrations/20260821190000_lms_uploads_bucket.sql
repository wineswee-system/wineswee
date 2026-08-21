-- 教育訓練「上傳作業」用的 Storage bucket(員工自拍影片/檔案)。
-- 沿用本專案附件慣例:public bucket + getPublicUrl;authenticated 可上傳。idempotent。
INSERT INTO storage.buckets (id, name, public)
VALUES ('lms-uploads', 'lms-uploads', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS lms_uploads_insert ON storage.objects;
CREATE POLICY lms_uploads_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lms-uploads');

DROP POLICY IF EXISTS lms_uploads_read ON storage.objects;
CREATE POLICY lms_uploads_read ON storage.objects FOR SELECT
  USING (bucket_id = 'lms-uploads');

DROP POLICY IF EXISTS lms_uploads_delete ON storage.objects;
CREATE POLICY lms_uploads_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'lms-uploads');
