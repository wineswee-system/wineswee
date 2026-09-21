-- Set EMP-003 as Alicia, manager (finance dept head)
-- Move ALL references from EMP-108 (id=150) to EMP-003 (id=45), then delete EMP-108

BEGIN;

UPDATE employees
SET name       = 'Alicia',
    role_id    = 3,
    role       = 'manager',
    is_manager = true,
    dept       = '財務部'
WHERE employee_number = 'EMP-003';

-- Reassign all FK references from id=150 → id=45
UPDATE departments               SET manager_id   = 45 WHERE manager_id   = 150;
UPDATE department_manager_history SET manager_id  = 45 WHERE manager_id   = 150;
DELETE FROM employee_assignments                    WHERE employee_id  = 150;
UPDATE employee_assignments      SET updated_by   = 45 WHERE updated_by   = 150;
UPDATE employee_dependents       SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE employee_line_accounts    SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE employee_reviews          SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE employee_schedule_prefs   SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE employee_skills           SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE employee_transfers        SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE employees                 SET supervisor_id= 45 WHERE supervisor_id= 150;
UPDATE employees                 SET reporting_to = 45 WHERE reporting_to = 150;
UPDATE employees                 SET updated_by   = 45 WHERE updated_by   = 150;
UPDATE expense_requests          SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE journal_entries           SET created_by_id= 45 WHERE created_by_id= 150;
UPDATE leave_balances            SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE leave_requests            SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE leave_requests            SET approved_by  = 45 WHERE approved_by  = 150;
UPDATE line_users                SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE off_requests              SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE overtime_requests         SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE overtime_requests         SET approved_by  = 45 WHERE approved_by  = 150;
UPDATE payroll_records           SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE payroll_runs              SET created_by   = 45 WHERE created_by   = 150;
UPDATE pos_shifts                SET cashier_id   = 45 WHERE cashier_id   = 150;
UPDATE pos_transactions          SET cashier_id   = 45 WHERE cashier_id   = 150;
UPDATE project_members           SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE projects                  SET owner_id     = 45 WHERE owner_id     = 150;
UPDATE punch_corrections         SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE purchase_requests         SET requester_id = 45 WHERE requester_id = 150;
UPDATE purchase_requests         SET approved_by_id=45 WHERE approved_by_id=150;
UPDATE quotations                SET created_by_id= 45 WHERE created_by_id= 150;
UPDATE returns                   SET processed_by_id=45 WHERE processed_by_id=150;
UPDATE salary_records            SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE salary_structures         SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE sales_orders              SET created_by_id= 45 WHERE created_by_id= 150;
UPDATE schedules                 SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE stores                    SET manager_id   = 45 WHERE manager_id   = 150;
UPDATE task_activity             SET actor_id     = 45 WHERE actor_id     = 150;
UPDATE task_mentions             SET mentioned_employee_id=45 WHERE mentioned_employee_id=150;
UPDATE task_watchers             SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE tasks                     SET assignee_id  = 45 WHERE assignee_id  = 150;
UPDATE user_stores               SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE workflow_instances        SET started_by_id= 45 WHERE started_by_id= 150;
UPDATE approval_chain_steps      SET target_emp_id= 45 WHERE target_emp_id= 150;
UPDATE attendance_records        SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE benefit_policies          SET employee_id  = 45 WHERE employee_id  = 150;
UPDATE bonus_records             SET employee_id  = 45 WHERE employee_id  = 150;

DELETE FROM employees WHERE employee_number = 'EMP-108';

COMMIT;
