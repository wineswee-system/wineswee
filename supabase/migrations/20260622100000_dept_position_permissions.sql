-- ════════════════════════════════════════════════════════════
-- Department & Position-based permissions (2026-06-22)
--
-- Problem: 5-role RBAC alone is too coarse.
--   A finance-dept office_staff needs finance.view.
--   A '門市主管' position needs CRM access even with store_staff role.
--   Individual override per person doesn't scale.
--
-- Solution: two new grant layers between role and individual:
--
--   Priority (highest → lowest):
--     1. employee_permissions revoke — explicit block always wins
--     2. employee_permissions grant  — explicit extra access
--     3. role_permissions            — role default
--     4. department_permissions      — dept membership
--     5. position_permissions        — job title/position
--
-- effective = (role OR dept OR position OR individual_grant)
--             AND NOT individual_revoke
--
-- Backward-compatible: empty new tables → 100% same behaviour as before.
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. department_permissions ═══
CREATE TABLE IF NOT EXISTS public.department_permissions (
  id            SERIAL PRIMARY KEY,
  department_id INT  NOT NULL REFERENCES public.departments(id)  ON DELETE CASCADE,
  permission_id INT  NOT NULL REFERENCES public.permissions(id)  ON DELETE CASCADE,
  granted_by    INT  REFERENCES public.employees(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(department_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_dept_perm_dept ON public.department_permissions(department_id);
CREATE INDEX IF NOT EXISTS idx_dept_perm_perm ON public.department_permissions(permission_id);

ALTER TABLE public.department_permissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'department_permissions' AND policyname = 'same_org_read'
  ) THEN
    CREATE POLICY same_org_read ON public.department_permissions
      FOR SELECT USING (
        department_id IN (
          SELECT id FROM departments
           WHERE organization_id IN (
             SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
           )
        )
        OR auth.role() = 'service_role'
      );
  END IF;
END $$;


-- ═══ 2. position_permissions ═══
-- position matches employees.position (free-text), scoped per org
CREATE TABLE IF NOT EXISTS public.position_permissions (
  id              SERIAL PRIMARY KEY,
  organization_id INT  NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  position        TEXT NOT NULL,
  permission_id   INT  NOT NULL REFERENCES public.permissions(id)   ON DELETE CASCADE,
  granted_by      INT  REFERENCES public.employees(id) ON DELETE SET NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, position, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_perm_org_pos ON public.position_permissions(organization_id, position);
CREATE INDEX IF NOT EXISTS idx_pos_perm_perm     ON public.position_permissions(permission_id);

ALTER TABLE public.position_permissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'position_permissions' AND policyname = 'same_org_read'
  ) THEN
    CREATE POLICY same_org_read ON public.position_permissions
      FOR SELECT USING (
        organization_id IN (
          SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
        )
        OR auth.role() = 'service_role'
      );
  END IF;
END $$;


-- ═══ 3. liff_employee_has_permission — add dept + position branches ═══
CREATE OR REPLACE FUNCTION public.liff_employee_has_permission(
  p_emp_id    int,
  p_perm_code text
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees e
    JOIN roles r ON r.id = e.role_id
    WHERE e.id = p_emp_id AND r.name = 'super_admin'
  )
  OR (
    NOT EXISTS (
      SELECT 1 FROM employee_permissions ep
      JOIN permissions p ON p.id = ep.permission_id
      WHERE ep.employee_id = p_emp_id
        AND p.code = p_perm_code
        AND ep.mode = 'revoke'
    )
    AND (
      EXISTS (
        SELECT 1 FROM employee_permissions ep
        JOIN permissions p ON p.id = ep.permission_id
        WHERE ep.employee_id = p_emp_id AND p.code = p_perm_code AND ep.mode = 'grant'
      )
      OR EXISTS (
        SELECT 1 FROM employees e
        JOIN role_permissions rp ON rp.role_id = e.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE e.id = p_emp_id AND p.code = p_perm_code
      )
      OR EXISTS (
        SELECT 1 FROM employees e
        JOIN department_permissions dp ON dp.department_id = e.department_id
        JOIN permissions p ON p.id = dp.permission_id
        WHERE e.id = p_emp_id AND p.code = p_perm_code
      )
      OR EXISTS (
        SELECT 1 FROM employees e
        JOIN position_permissions pp
          ON pp.organization_id = e.organization_id
         AND pp.position        = e.position
        JOIN permissions p ON p.id = pp.permission_id
        WHERE e.id = p_emp_id AND p.code = p_perm_code
          AND e.position IS NOT NULL
      )
    )
  );
$$;


-- ═══ 4. get_employee_effective_permissions — add dept + position sources ═══
DROP FUNCTION IF EXISTS public.get_employee_effective_permissions(int);

CREATE FUNCTION public.get_employee_effective_permissions(p_emp_id int)
RETURNS TABLE (
  permission_id    INT,
  code             TEXT,
  name             TEXT,
  module           TEXT,
  source           TEXT,      -- role | department | position | grant | role_revoke | none
  effective        BOOLEAN,
  override_reason  TEXT,
  override_at      TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp         employees;
  v_caller      employees;
  v_caller_role TEXT;
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
        WHEN ep.mode = 'grant'       THEN 'grant'
        WHEN ep.mode = 'revoke'      THEN 'role_revoke'
        WHEN rp.role_id IS NOT NULL  THEN 'role'
        WHEN dp.id      IS NOT NULL  THEN 'department'
        WHEN pp.id      IS NOT NULL  THEN 'position'
        ELSE 'none'
      END AS source,
      CASE
        WHEN ep.mode = 'revoke'      THEN FALSE
        WHEN ep.mode = 'grant'       THEN TRUE
        WHEN rp.role_id IS NOT NULL  THEN TRUE
        WHEN dp.id      IS NOT NULL  THEN TRUE
        WHEN pp.id      IS NOT NULL  THEN TRUE
        ELSE FALSE
      END AS effective,
      ep.reason     AS override_reason,
      ep.updated_at AS override_at
    FROM permissions p
    LEFT JOIN role_permissions rp
      ON rp.permission_id = p.id
     AND rp.role_id = v_emp.role_id
    LEFT JOIN department_permissions dp
      ON dp.permission_id = p.id
     AND dp.department_id = v_emp.department_id
    LEFT JOIN position_permissions pp
      ON pp.permission_id   = p.id
     AND pp.organization_id = v_emp.organization_id
     AND v_emp.position IS NOT NULL
     AND pp.position = v_emp.position
    LEFT JOIN employee_permissions ep
      ON ep.permission_id = p.id
     AND ep.employee_id   = p_emp_id
    WHERE (
      v_caller_role = 'super_admin'
      OR p.is_active = true
      OR ep.id IS NOT NULL
    )
    ORDER BY p.module, p.id;
END $$;

GRANT EXECUTE ON FUNCTION public.get_employee_effective_permissions(int) TO authenticated;


-- ═══ 5. manage_department_permission RPC ═══
CREATE OR REPLACE FUNCTION public.manage_department_permission(
  p_dept_id  INT,
  p_perm_id  INT,
  p_action   TEXT,    -- 'grant' | 'revoke'
  p_note     TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller      employees;
  v_caller_role TEXT;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT name INTO v_caller_role FROM roles WHERE id = v_caller.role_id;
  IF v_caller_role NOT IN ('super_admin', 'admin') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  IF p_action NOT IN ('grant', 'revoke') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;

  IF p_action = 'revoke' THEN
    DELETE FROM department_permissions
     WHERE department_id = p_dept_id AND permission_id = p_perm_id;
    RETURN json_build_object('ok', true, 'action', 'revoked');
  END IF;

  INSERT INTO department_permissions (department_id, permission_id, granted_by, note)
  VALUES (p_dept_id, p_perm_id, v_caller.id, p_note)
  ON CONFLICT (department_id, permission_id) DO UPDATE SET
    granted_by = EXCLUDED.granted_by,
    note       = EXCLUDED.note;

  RETURN json_build_object('ok', true, 'action', 'granted');
END $$;

GRANT EXECUTE ON FUNCTION public.manage_department_permission(INT, INT, TEXT, TEXT) TO authenticated;


-- ═══ 6. manage_position_permission RPC ═══
CREATE OR REPLACE FUNCTION public.manage_position_permission(
  p_org_id   INT,
  p_position TEXT,
  p_perm_id  INT,
  p_action   TEXT,    -- 'grant' | 'revoke'
  p_note     TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller      employees;
  v_caller_role TEXT;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT name INTO v_caller_role FROM roles WHERE id = v_caller.role_id;
  IF v_caller_role NOT IN ('super_admin', 'admin') THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  IF p_action NOT IN ('grant', 'revoke') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;

  IF p_action = 'revoke' THEN
    DELETE FROM position_permissions
     WHERE organization_id = p_org_id
       AND position = p_position
       AND permission_id = p_perm_id;
    RETURN json_build_object('ok', true, 'action', 'revoked');
  END IF;

  INSERT INTO position_permissions (organization_id, position, permission_id, granted_by, note)
  VALUES (p_org_id, p_position, p_perm_id, v_caller.id, p_note)
  ON CONFLICT (organization_id, position, permission_id) DO UPDATE SET
    granted_by = EXCLUDED.granted_by,
    note       = EXCLUDED.note;

  RETURN json_build_object('ok', true, 'action', 'granted');
END $$;

GRANT EXECUTE ON FUNCTION public.manage_position_permission(INT, TEXT, INT, TEXT, TEXT) TO authenticated;


-- ═══ 7. Helper view: distinct positions per org ═══
-- Lets admin UI show a dropdown of existing position names
CREATE OR REPLACE VIEW public.org_positions AS
  SELECT organization_id, position, COUNT(*) AS headcount
    FROM public.employees
   WHERE position IS NOT NULL AND position <> ''
   GROUP BY organization_id, position
   ORDER BY organization_id, position;

GRANT SELECT ON public.org_positions TO authenticated;


COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════
-- Verify after applying:
--
-- -- Grant finance.view to Finance dept (replace 3 with real dept id)
-- SELECT manage_department_permission(3,
--   (SELECT id FROM permissions WHERE code = 'finance.view'),
--   'grant', '財務部預設');
--
-- -- Grant CRM access to '門市主管' position in org 1
-- SELECT manage_position_permission(1, '門市主管',
--   (SELECT id FROM permissions WHERE code = 'nav.group.crm'),
--   'grant', '門市主管可看 CRM');
--
-- -- Check effective permissions for an employee
-- SELECT code, source, effective
--   FROM get_employee_effective_permissions(<emp_id>)
--  WHERE effective = true
--  ORDER BY module;
--
-- -- List all positions in org 1
-- SELECT position, headcount FROM org_positions WHERE organization_id = 1;
-- ════════════════════════════════════════════════════════════
