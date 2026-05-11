-- ════════════════════════════════════════════════════════════
-- 把 legacy role='employee' 統一改成 office_staff（role_id=4）
--
-- 起因：舊資料把所有沒明確分類的員工都標 role='employee'，但這個
-- 字串不在 5 角色系統（store_staff/office_staff/manager/admin/super_admin）
-- 裡面。App.jsx 的 ROLE_ROUTES 沒這個 key，會 fallback 成 store_staff
-- 的權限，而不是預期的 office_staff（行政人員）。
--
-- 修法：直接把所有 role='employee' 的員工正規化成 office_staff +
-- 對應的 role_id=4。同時也修可能漏 role_id 的 row。
--
-- Idempotent — 重跑無害。
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 確保 roles 表有 office_staff（id=4） ──
-- 若已存在則不動；以 ON CONFLICT DO NOTHING 防呆
INSERT INTO public.roles (id, name)
VALUES (4, 'office_staff')
ON CONFLICT (id) DO NOTHING;

-- ── 2. 把 employees.role='employee' 改成 'office_staff' ──
UPDATE public.employees
   SET role     = 'office_staff',
       role_id  = 4
 WHERE role = 'employee';

-- ── 3. 同時補 role_id 為 NULL 但有 role 字串的 row ──
-- （safety net：避免 role='office_staff' 但 role_id IS NULL 之類的 drift）
UPDATE public.employees e
   SET role_id = r.id
  FROM public.roles r
 WHERE e.role IS NOT NULL
   AND e.role = r.name
   AND e.role_id IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
