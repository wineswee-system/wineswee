-- ════════════════════════════════════════════════════════════════════════════
-- 建 Supabase Storage bucket "uploads" 給自訂表單 (CustomFormFill) 上傳用
-- ────────────────────────────────────────────────────────────────────────────
-- 廠商反饋：自訂表單上傳照片時報「Bucket not found」。
-- CustomFormFill.jsx hardcode bucket name = 'uploads' 但 Storage 沒這 bucket。
--
-- 修法：
--   1. INSERT 到 storage.buckets 建 'uploads' bucket，public=true（讓 getPublicUrl 能直接拿 URL）
--   2. 加 storage.objects RLS policy:
--      - authenticated / anon 都能 INSERT (上傳)
--      - public SELECT (任何人能讀)
--      - authenticated 能 DELETE (上傳者改主意刪)
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. 建 bucket（idempotent）
INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO UPDATE SET public = true;


-- 2. RLS policies on storage.objects (限定 bucket_id = 'uploads')
DROP POLICY IF EXISTS "uploads_authenticated_insert" ON storage.objects;
CREATE POLICY "uploads_authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'uploads');

DROP POLICY IF EXISTS "uploads_anon_insert" ON storage.objects;
CREATE POLICY "uploads_anon_insert" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'uploads');

DROP POLICY IF EXISTS "uploads_public_read" ON storage.objects;
CREATE POLICY "uploads_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'uploads');

DROP POLICY IF EXISTS "uploads_authenticated_delete" ON storage.objects;
CREATE POLICY "uploads_authenticated_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'uploads');

DROP POLICY IF EXISTS "uploads_authenticated_update" ON storage.objects;
CREATE POLICY "uploads_authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'uploads')
  WITH CHECK (bucket_id = 'uploads');

COMMIT;
