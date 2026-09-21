-- 周容甄 role office_staff → manager(營運經理) — 2026-07-24
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:周容甄(#425)是「靠權限 override 設成營運經理」(有 schedule.view_all/store_audit.view_all
--   employee_permissions override),但 role 還是 office_staff → LIFF 人力儀表板存取(綁 role)抓不到她。
-- 修:role 改 manager。她的 view_all 是 employee_permissions override(綁 employee_id 非 role)→ 改 role 全保留;
--   另拿到 manager 的 nav.dashboard.hr(role_permissions)→ 儀表板入口顯示 + RPC 放行;
--   scope 靠 schedule.view_all(override)→ see_all=全公司;isManagerOnly(role=manager)→ 只看人力 tab。
-- guard 現值 office_staff → idempotent。
-- ════════════════════════════════════════════════════════════════════════════
UPDATE employees
   SET role_id = (SELECT id FROM roles WHERE name = 'manager' LIMIT 1)
 WHERE id = 425
   AND name = '周容甄'
   AND role_id = (SELECT id FROM roles WHERE name = 'office_staff' LIMIT 1);

NOTIFY pgrst, 'reload schema';
