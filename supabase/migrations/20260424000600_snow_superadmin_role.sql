-- Promote Snow to super_admin role (role_id = 1)

BEGIN;

UPDATE employees
SET
  role_id    = 1,
  role       = 'super_admin',
  is_manager = true
WHERE name = 'Snow';

COMMIT;
