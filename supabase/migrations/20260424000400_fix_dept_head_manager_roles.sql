-- Fix: Department heads were seeded with office_staff/store_staff role
-- instead of manager role. Promote all employees referenced as manager_id
-- in any department to role_id = 3 (manager).

BEGIN;

UPDATE employees e
SET
  role_id    = 3,
  role       = 'manager',
  is_manager = true
FROM departments d
WHERE d.manager_id = e.id
  AND e.role_id <> 3;

COMMIT;
