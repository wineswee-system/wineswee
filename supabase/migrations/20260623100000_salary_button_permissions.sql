-- ════════════════════════════════════════════════════════════════════════════
-- 薪資管理按鈕細項權限：匯出報表 / 發送薪資條
-- 2026-06-23
--
-- 規則：admin/super_admin 永遠可用(前端 isAdmin 短路);其他角色預設「關」,
--   要在「系統設定 → 員工個別權限」逐個開。
--   - salary.export       : 匯出薪資報表(PDF)
--   - salary.send_payslip : 發送薪資條 LINE(高風險:一次推給全體)
-- 只 grant 給 super_admin + admin(其餘預設無 → 需手動授予)。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.permissions (code, name, module, is_active) VALUES
  ('salary.export',       '匯出薪資報表',        '薪酬與福利', true),
  ('salary.send_payslip', '發送薪資條 (LINE)',   '薪酬與福利', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, module = EXCLUDED.module, is_active = EXCLUDED.is_active;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.name IN ('super_admin', 'admin')
  AND p.code IN ('salary.export', 'salary.send_payslip')
ON CONFLICT DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
