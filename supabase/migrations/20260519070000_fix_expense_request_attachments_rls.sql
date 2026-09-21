-- ════════════════════════════════════════════════════════════════════════════
-- expense_request_attachments authenticated INSERT 被 RLS 擋（編輯費用申請
-- 上傳附件時 toast 報 "new row violates row-level security policy"）
-- ────────────────────────────────────────────────────────────────────────────
-- Root cause: 20260424200000 的 IF NOT EXISTS guard 條件可能因為 live DB
-- 已有某條 authenticated policy 而跳過 CREATE USING(true) 全開那條，導致
-- INSERT/UPDATE 沒有對應 WITH CHECK = true → 全部擋掉。
--
-- 修法：強制 DROP + CREATE 一條乾淨的 FOR ALL TO authenticated USING(true)
-- WITH CHECK(true)，對齊 expense_requests 主表的權限寬度。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.expense_request_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_expense_request_attachments ON public.expense_request_attachments;
DROP POLICY IF EXISTS expense_request_attachments_auth_all ON public.expense_request_attachments;

CREATE POLICY expense_request_attachments_auth_all
  ON public.expense_request_attachments
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expense_request_attachments TO authenticated;

-- 順手檢查同樣的 anon policy 還在（LIFF 上傳附件用，不能砍）
DROP POLICY IF EXISTS anon_expense_req_att ON public.expense_request_attachments;
CREATE POLICY anon_expense_req_att
  ON public.expense_request_attachments
  FOR ALL TO anon
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expense_request_attachments TO anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
