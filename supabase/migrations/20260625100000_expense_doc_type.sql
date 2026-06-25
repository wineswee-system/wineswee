-- ════════════════════════════════════════════════════════════════════════════
-- expense_requests 加 doc_type:區分「非經常性費用申請」(expense) 與「叫貨申請單」(order)
-- 2026-06-25
--
-- 叫貨申請單 = 用同一張表 + 同一套引擎(申請/核銷/簽核/快照/PDF),靠 doc_type 區分清單/頁面/編號。
-- 既有資料一律 'expense'。純加欄、idempotent。
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.expense_requests
  ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'expense';

ALTER TABLE public.expense_requests
  DROP CONSTRAINT IF EXISTS expense_requests_doc_type_check;
ALTER TABLE public.expense_requests
  ADD CONSTRAINT expense_requests_doc_type_check CHECK (doc_type IN ('expense', 'order'));

CREATE INDEX IF NOT EXISTS idx_expense_requests_doc_type ON public.expense_requests(doc_type);

NOTIFY pgrst, 'reload schema';
