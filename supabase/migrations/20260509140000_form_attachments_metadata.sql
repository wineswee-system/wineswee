-- ════════════════════════════════════════════════════════════
-- M1: form_attachments metadata 表
--
-- 至此 8 張表的附件做法不一致：
--   - resignation/transfer: row 上一個 attachment_url TEXT
--   - leave/expenses/overtime/punch: 直接傳 storage bucket，沒 metadata
--   - 其他: 沒做
--
-- 統一收斂進 form_attachments：每筆 row 對應一個附件，記錄 storage 位置 +
-- metadata。新上傳走這張；舊資料（attachment_url + 舊 bucket 檔）保留不動，
-- 待 backfill。
--
-- form_type 命名跟 form_chain_configs 對齊：leave/overtime/trip/correction/
-- expense/expense_request/resignation/transfer/loa/shift_swap/off_request
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.form_attachments (
  id              SERIAL PRIMARY KEY,
  form_type       TEXT NOT NULL,
  form_id         INT  NOT NULL,
  organization_id INT  REFERENCES public.organizations(id) ON DELETE CASCADE,
  storage_bucket  TEXT NOT NULL DEFAULT 'attachments',
  storage_path    TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  file_size       BIGINT,
  mime_type       TEXT,
  uploaded_by_id  INT  REFERENCES public.employees(id) ON DELETE SET NULL,
  uploaded_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_attachments_form
  ON public.form_attachments(form_type, form_id);
CREATE INDEX IF NOT EXISTS idx_form_attachments_org
  ON public.form_attachments(organization_id);
CREATE INDEX IF NOT EXISTS idx_form_attachments_uploader
  ON public.form_attachments(uploaded_by_id);


-- ─── RLS：同 organization 才能讀 + 寫 ───
ALTER TABLE public.form_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS form_attachments_read_same_org ON public.form_attachments;
CREATE POLICY form_attachments_read_same_org
  ON public.form_attachments FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT organization_id FROM public.employees
       WHERE auth_user_id = auth.uid()
          OR email = auth.jwt() ->> 'email'
    )
  );

DROP POLICY IF EXISTS form_attachments_insert_authn ON public.form_attachments;
CREATE POLICY form_attachments_insert_authn
  ON public.form_attachments FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS form_attachments_delete_self ON public.form_attachments;
CREATE POLICY form_attachments_delete_self
  ON public.form_attachments FOR DELETE
  USING (
    uploaded_by_id IN (
      SELECT id FROM public.employees
       WHERE auth_user_id = auth.uid()
          OR email = auth.jwt() ->> 'email'
    )
  );


-- ─── RPC：列某張表單的所有附件（含 signed URL） ───
CREATE OR REPLACE FUNCTION public.list_form_attachments(
  p_form_type TEXT,
  p_form_id   INT
) RETURNS TABLE (
  id INT, file_name TEXT, file_size BIGINT, mime_type TEXT,
  storage_bucket TEXT, storage_path TEXT,
  uploaded_by TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, file_name, file_size, mime_type,
         storage_bucket, storage_path,
         uploaded_by, created_at
    FROM public.form_attachments
   WHERE form_type = p_form_type AND form_id = p_form_id
   ORDER BY created_at;
$$;

GRANT EXECUTE ON FUNCTION public.list_form_attachments(TEXT, INT) TO authenticated, anon;


COMMIT;

NOTIFY pgrst, 'reload schema';
