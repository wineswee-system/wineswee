-- ════════════════════════════════════════════════════════════════════════════
-- 資安 線A 收尾：撤掉最後 2 個 anon 公網洞
--   expense_request_attachments / approval_extra_steps
--
-- ⚠️⚠️ 執行前提：LIFF 必須已 deploy 並生效（git master 8ce39d9 之後）⚠️⚠️
--   LIFF 已改走 liff_get_pending_extra_step / liff_list_request_attachments_for_card，
--   不再 anon 直查這兩張表。但「使用者快取的舊版 LIFF」仍靠 anon 直查，
--   先撤會讓舊版簽核頁的加簽區 / 推播卡片附件壞掉。
--
--   正確順序：
--     1. 主系統 migration 20260614160000（補 RPC）— 先跑 ✅
--     2. LIFF push master → Vercel deploy 完成
--     3. 自己在 LINE 重開 LIFF 簽核頁，確認加簽區正常、附件看得到（新版生效）
--     4. 才跑本檔
--
-- 跑完重跑守門員，🔴 致命應只剩 5 張裸表（無 RLS），anon 公網洞歸零。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- expense_request_attachments：原本 anon ALL(true) 全表 RW → 收掉
DROP POLICY IF EXISTS anon_expense_req_att ON public.expense_request_attachments;
REVOKE ALL ON public.expense_request_attachments FROM anon;

-- approval_extra_steps：原本 anon SELECT(true) → 收掉 anon 那條
--   （authenticated 的 approval_extra_steps_auth_read 屬 🟠 跨租戶，另波處理，這裡不動）
DROP POLICY IF EXISTS approval_extra_steps_anon_read ON public.approval_extra_steps;
REVOKE ALL ON public.approval_extra_steps FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
