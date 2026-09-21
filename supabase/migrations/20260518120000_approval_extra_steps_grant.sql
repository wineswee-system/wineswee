-- ════════════════════════════════════════════════════════════════════════════
-- approval_extra_steps：補上 RLS policy + GRANT
-- ────────────────────────────────────────────────────────────────────────────
-- 問題：表建立時沒 ALTER ENABLE RLS、沒 CREATE POLICY、也沒 GRANT。
--      Supabase 較新專案的預設行為可能 anon/authenticated 全部 deny SELECT，
--      於是 Web 主系統的 ExpenseRequests modal 從 client 直接
--      .from('approval_extra_steps').select(...) 抓不到加簽記錄
--      → mergeExtraSteps 拿到空陣列 → 進度條看不到加簽那一關。
--
-- LIFF 走 SECURITY DEFINER RPC 繞 RLS 沒事，所以 LIFF 進度看得到加簽。
--
-- 修法：補 GRANT + 開放 SELECT 給 authenticated / anon。
--   - INSERT/UPDATE/DELETE 不開（這三件都由 SECURITY DEFINER RPC
--     request_extra_signer / cancel_extra_signer / process_extra_signer 做）
--   - 跟同檔的 expense_requests RLS 採同樣寬度（USING true）— 加簽資料
--     本身不含敏感欄位（reason 不超敏感）。要更嚴可日後再加組織隔離。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.approval_extra_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_extra_steps_auth_read ON public.approval_extra_steps;
CREATE POLICY approval_extra_steps_auth_read
  ON public.approval_extra_steps
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS approval_extra_steps_anon_read ON public.approval_extra_steps;
CREATE POLICY approval_extra_steps_anon_read
  ON public.approval_extra_steps
  FOR SELECT TO anon
  USING (true);

GRANT SELECT ON TABLE public.approval_extra_steps TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
