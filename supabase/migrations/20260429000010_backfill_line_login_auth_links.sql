-- ============================================================
-- Backfill auth_user_id on employees for users who logged in via LINE
-- before the line-login Edge Function started writing auth_user_id back.
--
-- Symptom: AuthContext.loadProfile() can't resolve the employee row,
-- so Sidebar falls back to userRole = 'store_staff' regardless of
-- what employees.role actually says — the user sees a門市員工 menu
-- even though their DB role is admin/manager.
--
-- Match strategy:
-- auth.users.raw_user_meta_data->>'full_name' === employees.name
-- The line-login Edge Function sets full_name to employees.name
-- when it creates the Supabase auth user.
--
-- Confirmed today (2026-04-29) — 5 employees affected:
-- 張庭瑋, Zoey, Molly, Dave, Danny
-- (尤致皓 is already linked correctly.)
-- ============================================================

BEGIN;

-- 1. Clean up the literal "<their-login-email>" placeholder string
--    that got typed into Danny's email field. It was a UI placeholder
--    that someone copy-pasted into the value, not a real address.
UPDATE public.employees
SET email = NULL
WHERE email ILIKE '<their-login-email>%';

-- 2. Backfill auth_user_id by matching auth.users full_name to
--    employees.name. Only touches rows where auth_user_id is NULL,
--    so it's safe to re-run.
UPDATE public.employees e
SET auth_user_id = u.id
FROM auth.users u
WHERE u.raw_user_meta_data->>'full_name' = e.name
  AND e.auth_user_id IS NULL;

COMMIT;
