-- Link Snow's employee record to their Supabase auth account

BEGIN;

-- Set email on Snow's employee record
UPDATE employees
SET email = 'astrops.psych@gmail.com'
WHERE name = 'Snow'
  AND (email IS NULL OR email <> 'astrops.psych@gmail.com');

-- Backfill auth_user_id by matching email
UPDATE employees e
SET auth_user_id = u.id
FROM auth.users u
WHERE u.email = 'astrops.psych@gmail.com'
  AND e.name  = 'Snow'
  AND e.auth_user_id IS NULL;

COMMIT;
