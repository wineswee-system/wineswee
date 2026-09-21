-- 授營運部經理「門市稽核全覽」— 2026-07-23
-- ════════════════════════════════════════════════════════════════════════════
-- 20260723130000 的規則「營運部經理看全部門市」靠 liff.store_audit.view_all 權限,
-- 但驗證發現營運部經理(張庭瑋, id62)沒有此權限 → 規則對他等於沒生效(只看自己管的店)。
-- 授給「營運部」部門主管(departments.manager_id where name='營運部')= 張庭瑋。
-- 之後營運部經理換人,可在權限UI重新授予(此為個人 override)。
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO public.employee_permissions (employee_id, permission_id, mode, reason)
SELECT d.manager_id, p.id, 'grant', '營運部經理:門市稽核全覽(view_all)'
FROM public.departments d
CROSS JOIN public.permissions p
WHERE d.name = '營運部' AND d.manager_id IS NOT NULL
  AND p.code = 'liff.store_audit.view_all'
  AND NOT EXISTS (
    SELECT 1 FROM public.employee_permissions ep
    WHERE ep.employee_id = d.manager_id AND ep.permission_id = p.id
  );

NOTIFY pgrst, 'reload schema';
