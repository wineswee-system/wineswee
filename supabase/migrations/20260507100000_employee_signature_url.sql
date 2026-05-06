-- ============================================================
-- 員工個人簽章 / 印章圖片 URL
--
-- 用途：簽呈 PDF 在某關核可後，於該關簽核欄印出該員工的簽章圖
-- 路徑：透過前端「員工自助服務 → 個人資料」上傳到
--       Supabase Storage attachments bucket，路徑：
--         employee-signatures/{employee_id}/signature.{ext}
--       公開 URL 寫入 employees.signature_url
-- ============================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS signature_url TEXT;

COMMENT ON COLUMN public.employees.signature_url IS
  '員工個人簽章圖（PNG/JPG/SVG public URL）。上傳路徑：employee-signatures/{id}/signature.{ext}';

NOTIFY pgrst, 'reload schema';
