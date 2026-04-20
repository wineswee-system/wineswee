-- ============================================================
-- Drop dangling test auth users
--
-- 123@gmail.com and 456@gmail.com — last sign-in 2026-03-31, no employee row.
-- They couldn't access org data anyway (no employee link), but they're
-- credential surface area worth removing.
-- ============================================================

BEGIN;

-- auth.users cascades sessions/refresh_tokens/identities via auth schema FKs.
DELETE FROM auth.users
WHERE email IN ('123@gmail.com','456@gmail.com')
  AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.email = auth.users.email);

COMMIT;
