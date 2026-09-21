-- Promote Zoey to admin role (role_id = 2, level 100)

BEGIN;

UPDATE employees
SET
  role_id    = 2,
  role       = 'admin',
  is_manager = true
WHERE name = 'Zoey';

COMMIT;
