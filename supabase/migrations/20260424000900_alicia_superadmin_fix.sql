-- Fix: promote Alicia (the real astrops.psych@gmail.com account) to super_admin
--      and revert the incorrect email set on Snow

BEGIN;

-- Remove email mistakenly set on Snow
UPDATE employees
SET email        = NULL,
    auth_user_id = NULL
WHERE name  = 'Snow'
  AND email = 'astrops.psych@gmail.com';

-- Promote Alicia to super_admin
UPDATE employees
SET role_id    = 1,
    role       = 'super_admin',
    is_manager = true
WHERE email = 'astrops.psych@gmail.com';

-- Re-link Alicia's auth_user_id
UPDATE employees e
SET auth_user_id = u.id
FROM auth.users u
WHERE u.email = 'astrops.psych@gmail.com'
  AND e.email  = 'astrops.psych@gmail.com'
  AND e.auth_user_id IS NULL;

COMMIT;
