-- ════════════════════════════════════════════════════════════
-- RBAC Fixes (2026-06-21)
--
-- Fix A: Add 3 missing action perms used in EmployeePermissions.jsx FEATURES
--         hr_form.delete_all / hr_form.restore / bonus.store.compute
-- Fix B: get_employee_effective_permissions — admin can now see inactive perms
--         that have an individual override, so they can revoke them
-- Fix C: role_change_log table + trigger — audit trail for role_id changes
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ A. 3 missing action perms ═══
INSERT INTO public.permissions (code, name, module, is_active) VALUES
  ('hr_form.delete_all',  '刪除 HR 表單申請',   'HR 表單',    true),
  ('hr_form.restore',     '還原已刪除表單申請', 'HR 表單',    true),
  ('bonus.store.compute', '計算門市業績獎金',   '薪酬與福利', true)
ON CONFLICT (code) DO NOTHING;

-- super_admin: full access
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 1, id FROM public.permissions
 WHERE code IN ('hr_form.delete_all', 'hr_form.restore', 'bonus.store.compute')
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = 1 AND rp.permission_id = permissions.id
   );

-- admin: full access
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 2, id FROM public.permissions
 WHERE code IN ('hr_form.delete_all', 'hr_form.restore', 'bonus.store.compute')
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = 2 AND rp.permission_id = permissions.id
   );


-- ═══ B. Fix get_employee_effective_permissions ═══
-- admin now sees inactive perms (is_active=false) when the employee has an
-- individual override, so admin can revoke grants made by super_admin.
DROP FUNCTION IF EXISTS public.get_employee_effective_permissions(int);

CREATE FUNCTION public.get_employee_effective_permissions(p_emp_id int)
RETURNS TABLE (
  permission_id    INT,
  code             TEXT,
  name             TEXT,
  module           TEXT,
  source           TEXT,
  effective        BOOLEAN,
  override_reason  TEXT,
  override_at      TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp           employees;
  v_caller        employees;
  v_caller_role   TEXT;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN; END IF;

  SELECT roles.name INTO v_caller_role FROM roles WHERE roles.id = v_caller.role_id;

  IF NOT (
    v_caller_role IN ('super_admin', 'admin')
    OR v_caller.id = p_emp_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      p.id AS permission_id,
      p.code,
      p.name,
      p.module,
      CASE
        WHEN ep.mode = 'grant'      THEN 'grant'
        WHEN ep.mode = 'revoke'     THEN 'role_revoke'
        WHEN rp.role_id IS NOT NULL THEN 'role'
        ELSE 'none'
      END AS source,
      CASE
        WHEN ep.mode = 'grant'      THEN TRUE
        WHEN ep.mode = 'revoke'     THEN FALSE
        WHEN rp.role_id IS NOT NULL THEN TRUE
        ELSE FALSE
      END AS effective,
      ep.reason AS override_reason,
      ep.updated_at AS override_at
    FROM permissions p
    LEFT JOIN role_permissions rp
      ON rp.permission_id = p.id AND rp.role_id = v_emp.role_id
    LEFT JOIN employee_permissions ep
      ON ep.permission_id = p.id AND ep.employee_id = p_emp_id
   WHERE (
     v_caller_role = 'super_admin'  -- super_admin sees everything
     OR p.is_active = true          -- active perms visible to all callers
     OR ep.id IS NOT NULL           -- admin sees inactive perm only if there's an override
   )
   ORDER BY p.module, p.id;
END $$;

GRANT EXECUTE ON FUNCTION public.get_employee_effective_permissions(int) TO authenticated;


-- ═══ C. Role change audit log ═══
CREATE TABLE IF NOT EXISTS public.role_change_log (
  id           BIGSERIAL PRIMARY KEY,
  employee_id  INT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  old_role_id  INT REFERENCES public.roles(id) ON DELETE SET NULL,
  new_role_id  INT REFERENCES public.roles(id) ON DELETE SET NULL,
  changed_by   INT REFERENCES public.employees(id) ON DELETE SET NULL,
  reason       TEXT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_change_log_emp ON public.role_change_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_role_change_log_at  ON public.role_change_log(changed_at DESC);

-- RLS: admin/super_admin within same org can read; no direct INSERT (trigger only)
ALTER TABLE public.role_change_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'role_change_log' AND policyname = 'admin_read'
  ) THEN
    CREATE POLICY admin_read ON public.role_change_log
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM employees caller
          JOIN roles r ON r.id = caller.role_id
          WHERE caller.auth_user_id = auth.uid()
            AND r.name IN ('super_admin', 'admin')
            AND caller.organization_id IN (
              SELECT organization_id FROM employees
               WHERE id = role_change_log.employee_id
            )
        )
      );
  END IF;
END $$;

-- Trigger function: fires on every role_id UPDATE to employees
CREATE OR REPLACE FUNCTION public._log_role_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_changed_by INT;
BEGIN
  IF OLD.role_id IS NOT DISTINCT FROM NEW.role_id THEN
    RETURN NEW;
  END IF;

  -- Best-effort: may be NULL when changed via service_role or seed scripts
  SELECT id INTO v_changed_by
    FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  INSERT INTO role_change_log (employee_id, old_role_id, new_role_id, changed_by)
  VALUES (NEW.id, OLD.role_id, NEW.role_id, v_changed_by);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_role_change ON public.employees;
CREATE TRIGGER trg_log_role_change
  AFTER UPDATE OF role_id ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public._log_role_change();


COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════
-- Verify
-- SELECT code, module, is_active FROM permissions
--  WHERE code IN ('hr_form.delete_all','hr_form.restore','bonus.store.compute');
--
-- SELECT * FROM role_change_log LIMIT 5;
-- ════════════════════════════════════════════════════════════
