-- ════════════════════════════════════════════════════════════════════════════
-- 補洞：撤掉 reservations 系統的 anon 公網 policy
-- 2026-07-02
--
-- 背景（security_health_check 掃出 🔴 致命）：
--   20260626200000 訂位系統為「未來的消費者訂位 App」預留了 anon policy，但：
--     - "anon view reservations"   SELECT USING(true)  → 任何公網訪客撈全部客人
--        姓名 guest_name / 電話 guest_phone / email guest_email（個資外洩）
--     - "anon cancel reservation"  UPDATE USING(true)  → 任何人可取消任何訂位
--     - "anon create reservations" INSERT WITH CHECK(true) → 任意灌訂位
--     - "anon read reservation_rules" / "anon read res_tables" SELECT → 一併預留
--   消費者訂位端「還沒做」→ 這些 anon policy 目前沒有任何正當使用者，純漏洞。
--
-- 決策：現在全撤。後台店員管訂位走 "org members manage *"（authenticated，org
--   scope），不受影響。等日後真的做消費者訂位端，改走 SECURITY DEFINER RPC
--   （傳 confirmation_code + guest_phone 驗證後只回/改那一筆），而非 USING(true)。
--
-- 撤 policy 後 anon 對這些表 = 無 policy = RLS 預設拒絕。RLS 仍 enabled。
-- 冪等：DROP POLICY IF EXISTS。
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "anon view reservations"      ON public.reservations;
DROP POLICY IF EXISTS "anon cancel reservation"     ON public.reservations;
DROP POLICY IF EXISTS "anon create reservations"    ON public.reservations;
DROP POLICY IF EXISTS "anon read reservation_rules" ON public.reservation_rules;
DROP POLICY IF EXISTS "anon read res_tables"        ON public.res_tables;

NOTIFY pgrst, 'reload schema';
