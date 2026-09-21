-- 把 finance.edit 權限發給 admin 角色 — 2026-07-17
-- 需求:讓 admin 也看得到「經常性費用報銷」的「簽核設定」按鈕(原本只有 super_admin)。
-- finance.edit(id 45,「編輯傳票（未交付）」)gate 的東西:①Expenses 簽核設定按鈕 ②幣別頁編輯權。
--   範圍收斂,對 admin 合理。super_admin 本就全通、不受影響。
-- 用 code/name 子查詢定位、NOT EXISTS 去重 → idempotent(已發則 0 筆)。

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'admin'
  AND p.code = 'finance.edit'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

NOTIFY pgrst, 'reload schema';
