-- ============================================================
-- LOW-3: Auto-link employees.auth_user_id on new sign-ups
--
-- Current state: 111/113 employees have NULL auth_user_id because
-- they are seed records with no matching auth.users row yet.
-- The one-time backfill in 20260420020100 only linked the 2 real
-- accounts that existed at migration time.
--
-- Fix: trigger on auth.users AFTER INSERT — when someone signs
-- up with an email that matches an existing employee record,
-- auth_user_id is set automatically with no admin step required.
--
-- Manual helper: link_employee_auth_user(employee_id, auth_uid)
-- for admins to link accounts that signed up before this trigger,
-- or whose emails differ (e.g., corporate SSO alias).
-- ============================================================

BEGIN;

-- ─── Trigger function ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_link_employee_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.employees
  SET auth_user_id = NEW.id
  WHERE email = NEW.email
    AND auth_user_id IS NULL;

  RETURN NEW;
END;
$$;

-- ─── Attach trigger to auth.users ───────────────────────────
DROP TRIGGER IF EXISTS trg_auto_link_employee_on_signup ON auth.users;

CREATE TRIGGER trg_auto_link_employee_on_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_employee_auth_user();

-- ─── Manual link helper (admin use) ─────────────────────────
-- Allows an admin to link an employee to a specific auth UUID
-- after the fact (e.g. accounts created before this trigger,
-- or email-alias mismatches).
CREATE OR REPLACE FUNCTION public.link_employee_auth_user(
  p_employee_id INT,
  p_auth_uid    UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_employee_role() NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '權限不足：僅管理員可手動連結帳號';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_auth_uid) THEN
    RAISE EXCEPTION '找不到對應的 Auth 使用者：%', p_auth_uid;
  END IF;

  IF EXISTS (SELECT 1 FROM public.employees WHERE auth_user_id = p_auth_uid AND id <> p_employee_id) THEN
    RAISE EXCEPTION '此 Auth 帳號已連結其他員工';
  END IF;

  UPDATE public.employees
  SET auth_user_id = p_auth_uid
  WHERE id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到員工 ID：%', p_employee_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_employee_auth_user(INT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.link_employee_auth_user(INT, UUID) FROM anon;

-- ─── Re-run backfill for any still-unlinked employees ───────
-- Catches accounts that signed up between 20260420020100 and now.
UPDATE public.employees e
SET auth_user_id = u.id
FROM auth.users u
WHERE e.email IS NOT NULL
  AND u.email = e.email
  AND e.auth_user_id IS NULL;

-- ─── Validation warning (not an error — seed data expected) ─
DO $$
DECLARE
  still_unlinked INT;
BEGIN
  SELECT COUNT(*) INTO still_unlinked
  FROM public.employees
  WHERE auth_user_id IS NULL
    AND email IS NOT NULL;

  IF still_unlinked > 0 THEN
    RAISE WARNING '% employee(s) still have no auth_user_id — they have no auth account yet and will be linked automatically on first sign-up.', still_unlinked;
  END IF;
END $$;

COMMIT;
