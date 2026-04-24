-- Reassign astrops.psych@gmail.com to Snow (super_admin)
-- Clear Alicia's email and set her role to manager

BEGIN;

-- Step 1: clear Alicia's email + auth link first (avoids unique constraint conflict)
UPDATE employees
SET email        = NULL,
    auth_user_id = NULL,
    role_id      = 3,
    role         = 'manager',
    is_manager   = true
WHERE email = 'astrops.psych@gmail.com';

-- Step 2: assign email + super_admin to Snow
UPDATE employees
SET email      = 'astrops.psych@gmail.com',
    role_id    = 1,
    role       = 'super_admin',
    is_manager = true
WHERE name = 'Snow';

-- Step 3: backfill Snow's auth_user_id from auth.users
UPDATE employees e
SET auth_user_id = u.id
FROM auth.users u
WHERE u.email = 'astrops.psych@gmail.com'
  AND e.name   = 'Snow'
  AND e.auth_user_id IS NULL;

COMMIT;
