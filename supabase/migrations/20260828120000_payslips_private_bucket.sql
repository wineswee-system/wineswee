-- 薪資單 PDF 私有桶:LIFF(anon)只能「上傳」,不能讀;讀取一律走 sign-payslip edge function 用 service_role 簽短效網址。
-- 目的:讓 Android LINE 能拿到「真實 https 網址」下載 PDF(繞開被擋的 blob),又不把薪資放公開桶。
INSERT INTO storage.buckets (id, name, public) VALUES ('payslips','payslips',false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS payslips_anon_insert ON storage.objects;
CREATE POLICY payslips_anon_insert ON storage.objects
  FOR INSERT TO anon WITH CHECK (bucket_id = 'payslips');

DROP POLICY IF EXISTS payslips_auth_insert ON storage.objects;
CREATE POLICY payslips_auth_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'payslips');
