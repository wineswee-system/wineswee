-- ════════════════════════════════════════════════════════════
-- 為 attachments storage bucket 補 RLS policy
-- 2026-05-14
--
-- 問題：費用申請、簽核附件、員工簽名等都用 attachments bucket，
-- 但這 bucket 從來沒設 storage.objects policy → RLS 預設全擋 →
-- 申請人 web 端 upload 看似 OK（前端 silent skip），DB 完全沒紀錄
-- → LIFF 審核者看到「無附件」。
--
-- 修法：
--   1. 確保 attachments bucket 存在
--   2. authenticated 全操作（INSERT/SELECT/UPDATE/DELETE）
--   3. anon 可 SELECT（給 LIFF 拿 public url 顯示）
-- ════════════════════════════════════════════════════════════

BEGIN;

-- 確保 bucket 存在（public=true 讓 getPublicUrl 拿得到可訪問 URL）
INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- authenticated: 全操作
DROP POLICY IF EXISTS auth_attachments_all ON storage.objects;
CREATE POLICY auth_attachments_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'attachments')
  WITH CHECK (bucket_id = 'attachments');

-- anon: 可 SELECT（LIFF 顯示用）
DROP POLICY IF EXISTS anon_attachments_read ON storage.objects;
CREATE POLICY anon_attachments_read ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'attachments');

COMMIT;

-- 驗證
SELECT policyname, roles, cmd FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects'
   AND policyname LIKE '%attachments%';
