-- ============================================================
-- Redesign approval_chain_steps for the role / department / person mix
--
-- Live state: 20/20 steps have role_id NULL because the names mix
--   real roles  (店長, 督導, 經理, 執行長)
--   departments (人資部, 採購部, 營運部)
--   individuals (陳虹, 洪伯嘉, Alicia)
--
-- New schema:
--   target_type     TEXT CHECK ('role','department','employee','label')
--   target_role_id  INT  REFERENCES roles(id)
--   target_dept_id  INT  REFERENCES departments(id)
--   target_emp_id   INT  REFERENCES employees(id)
--
-- Backfill rule (per role_name):
--   1. Match employees.name → target_type='employee', set target_emp_id
--   2. Match departments.name → target_type='department', set target_dept_id
--   3. Match roles.name → target_type='role', set target_role_id
--   4. Otherwise → target_type='label' (still resolvable manually later)
-- ============================================================

BEGIN;

ALTER TABLE public.approval_chain_steps
  ADD COLUMN IF NOT EXISTS target_type TEXT,
  ADD COLUMN IF NOT EXISTS target_role_id INT REFERENCES public.roles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_dept_id INT REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_emp_id  INT REFERENCES public.employees(id) ON DELETE SET NULL;

-- Backfill: employees match wins over departments wins over roles
UPDATE public.approval_chain_steps s
SET target_type = 'employee',
    target_emp_id = e.id
FROM public.employees e
WHERE s.target_type IS NULL
  AND e.name = s.role_name;

UPDATE public.approval_chain_steps s
SET target_type = 'department',
    target_dept_id = d.id
FROM public.departments d
WHERE s.target_type IS NULL
  AND d.name = s.role_name;

UPDATE public.approval_chain_steps s
SET target_type = 'role',
    target_role_id = r.id
FROM public.roles r
WHERE s.target_type IS NULL
  AND r.name = s.role_name;

-- Anything still NULL → label (manual resolution later)
UPDATE public.approval_chain_steps
SET target_type = 'label'
WHERE target_type IS NULL;

-- Now constrain
ALTER TABLE public.approval_chain_steps
  ALTER COLUMN target_type SET NOT NULL,
  ADD CONSTRAINT approval_chain_steps_target_type_chk
    CHECK (target_type IN ('role','department','employee','label')),
  ADD CONSTRAINT approval_chain_steps_target_consistency_chk
    CHECK (
      (target_type='role'       AND target_role_id IS NOT NULL AND target_dept_id IS NULL  AND target_emp_id IS NULL)
      OR (target_type='department' AND target_dept_id IS NOT NULL AND target_role_id IS NULL AND target_emp_id IS NULL)
      OR (target_type='employee'   AND target_emp_id  IS NOT NULL AND target_role_id IS NULL AND target_dept_id IS NULL)
      OR (target_type='label'      AND target_role_id IS NULL  AND target_dept_id IS NULL AND target_emp_id IS NULL)
    );

CREATE INDEX IF NOT EXISTS idx_acs_target_role ON public.approval_chain_steps(target_role_id);
CREATE INDEX IF NOT EXISTS idx_acs_target_dept ON public.approval_chain_steps(target_dept_id);
CREATE INDEX IF NOT EXISTS idx_acs_target_emp  ON public.approval_chain_steps(target_emp_id);

COMMIT;
