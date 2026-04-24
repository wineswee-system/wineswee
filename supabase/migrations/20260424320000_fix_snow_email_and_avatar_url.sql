-- Fix two root causes of the 400 errors on employee login lookup:
-- 1. avatar_url column never existed in any migration — add it so the
--    AuthContext select doesn't fail with "column does not exist" (HTTP 400).
-- 2. Migration 001000 cleared Snow's email with a blanket email=NULL;
--    the step that was supposed to re-set it was a no-op (Snow didn't
--    exist yet at that point). Re-set it now so the email-fallback path works.

BEGIN;

-- 1. Add avatar_url column (safe no-op if it already exists)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Re-set Snow's email (id=44) which was cleared by migration 001000.
--    Clear from any other holder first to avoid unique constraint conflict.
UPDATE employees
SET email = NULL
WHERE email = 'astrops.psych@gmail.com'
  AND id <> 44;

UPDATE employees
SET email = 'astrops.psych@gmail.com'
WHERE id = 44;

-- 3. Re-link auth_user_id in case it drifted
UPDATE employees e
SET auth_user_id = u.id
FROM auth.users u
WHERE u.email = 'astrops.psych@gmail.com'
  AND e.id = 44
  AND (e.auth_user_id IS NULL OR e.auth_user_id <> u.id);

COMMIT;
