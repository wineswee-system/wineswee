-- ════════════════════════════════════════════════════════════════════════════
-- headcount_requests: 加 store_id 欄位
-- ────────────────────────────────────────────────────────────────────────────
-- 業務需求：人力需求是「為哪間門市補人」，所以要綁門市
-- 設 ON DELETE SET NULL（門市關閉時保留歷史申請）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.headcount_requests
  ADD COLUMN IF NOT EXISTS store_id INT REFERENCES public.stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_headcount_store
  ON public.headcount_requests(store_id) WHERE status = '申請中';

COMMENT ON COLUMN public.headcount_requests.store_id IS
  '需求門市（為哪間店補人）— 可為 NULL（純後勤需求）';

COMMIT;

NOTIFY pgrst, 'reload schema';
