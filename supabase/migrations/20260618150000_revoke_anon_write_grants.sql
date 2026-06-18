-- ════════════════════════════════════════════════════════════════════════════
-- 治本：撤掉 anon 對所有 public 表的「寫」grant（防呆 — 就算日後誤加 true 寫 policy 也擋住）
-- 2026-06-18
--
-- 背景：20260618130000 已把 true 寫 policy 收成 is_staff()(policy 層擋 anon)。本支再收
--   grant 層:撤掉 anon 的 INSERT/UPDATE/DELETE/TRUNCATE grant。anon 一律走 SECURITY
--   DEFINER RPC(以 owner 身分繞 RLS，不需要 anon 直接寫表的 grant) → 撤掉零功能影響。
--   雙層防護:就算未來有人又加 USING(true) 寫 policy，anon 沒 grant 還是寫不進去。
--
-- 不動 SELECT grant(anon 某些登入前讀取可能需要;且讀已被 RLS 過濾)。
-- 同時設 default privileges，讓「日後新建的表」也預設不給 anon 寫。
--
-- idempotent：REVOKE 可重複執行。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;

-- 日後新建的表也預設不給 anon 寫（針對目前建表者 postgres / supabase_admin）
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
