-- ════════════════════════════════════════════════════════════
-- 首頁戰情儀表板分頁權限：人·HR / 流程 各一個 toggle
-- 2026-06-16
--
-- 需求：admin 可在權限頁逐人控制誰看得到哪個儀表板分頁。
--   原本「誰看哪種儀表板」是 Dashboard.jsx 角色 hardcode；這裡把
--   TeamDashboard 的兩個分頁拆成可授予的 nav.* 碼。
--
-- 預設給 super_admin(1) / admin(2) / manager(3) —— 維持現狀
--   （這三種角色本來就看得到 TeamDashboard 兩個分頁）。
--   office_staff / store_staff 看的是 StaffDashboard / portal，不需要。
--
-- idempotent：用 NOT EXISTS 防重跑（Studio 無 transaction rollback）。
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 種兩個 nav 碼 ═══
INSERT INTO public.permissions (code, name, module, is_active)
SELECT v.code, v.name, '導航顯示', true
FROM (VALUES
  ('nav.dashboard.hr',      '戰情儀表板：人·HR 分頁'),
  ('nav.dashboard.process', '戰情儀表板：流程 分頁')
) AS v(code, name)
WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.code = v.code);

-- ═══ 2. 角色預設：super_admin / admin / manager ═══
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id, p.id
FROM (VALUES (1), (2), (3)) AS r(role_id)
CROSS JOIN public.permissions p
WHERE p.code IN ('nav.dashboard.hr', 'nav.dashboard.process')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
     WHERE rp.role_id = r.role_id AND rp.permission_id = p.id
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
