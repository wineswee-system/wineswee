-- Rename employee 'Alicia' to 'Snow' and set super_admin
-- All prior Snow migrations were no-ops (no employee named Snow existed)

BEGIN;

UPDATE employees
SET name       = 'Snow',
    role_id    = 1,
    role       = 'super_admin',
    is_manager = true
WHERE name = 'Alicia';


COMMIT;
