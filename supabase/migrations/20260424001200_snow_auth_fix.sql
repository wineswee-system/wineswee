-- Revert the two incorrectly renamed Snow employees back to Alicia
-- EMP-001 (id=44) is already correct: Snow, super_admin, email+auth linked

BEGIN;

-- EMP-003 (id=45): was store_staff Alicia, wrongly renamed to Snow
UPDATE employees
SET name       = 'Alicia',
    role_id    = 5,
    role       = 'store_staff',
    is_manager = false
WHERE employee_number = 'EMP-003';

-- EMP-108 (id=150): was finance dept head Alicia, wrongly renamed to Snow
UPDATE employees
SET name       = 'Alicia',
    role_id    = 3,
    role       = 'manager',
    is_manager = true
WHERE employee_number = 'EMP-108';

COMMIT;
