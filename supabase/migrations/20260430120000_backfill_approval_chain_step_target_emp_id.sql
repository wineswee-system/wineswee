-- Backfill target_emp_id + target_type for chain steps created before the UI fix.
-- Old UI saved only role_name (employee name string); target_emp_id was left NULL
-- and target_type defaulted to 'label', so _employee_matches_chain_step never fired.
--
-- Matches by employee name (role_name = employees.name).
-- Only touches rows where target_emp_id IS NULL to avoid clobbering already-fixed rows.

UPDATE approval_chain_steps acs
SET
  target_emp_id = e.id,
  target_type   = 'employee'
FROM employees e
WHERE acs.target_emp_id IS NULL
  AND acs.role_name IS NOT NULL
  AND acs.role_name <> ''
  AND e.name = acs.role_name
  AND e.status = '在職';
