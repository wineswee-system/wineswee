-- ════════════════════════════════════════════════════════════════════════════
-- 補 stores.organization_id — 新增門市時漏帶 org（高雄富民 #37 / 復興北 #38 = null）
-- 2026-07-02
--
-- 根因：門市管理新增流程（Locations.jsx createStore）payload 沒帶 organization_id，
--   createStore 就是 insert(data) 不自動填 → 新門市 org=null。
--   任務/LIFF 等有 `organization_id = profile.organization_id` filter 的門市下拉撈不到
--   → 使用者以為「沒有浮動更新」。前端已修（新增時帶 org_id）。
--
-- 單租戶（只有 org=1），org=null 一律該補成 1。
-- 冪等：只補 IS NULL。
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.stores
SET organization_id = 1
WHERE organization_id IS NULL;

NOTIFY pgrst, 'reload schema';
