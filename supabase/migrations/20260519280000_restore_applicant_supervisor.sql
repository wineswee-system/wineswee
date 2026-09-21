-- ════════════════════════════════════════════════════════════════════════════
-- 復活 applicant_supervisor target_type（依員工卡 supervisor_id 解）
-- ────────────────────────────────────────────────────────────────────────────
-- 慘案：ChainConfigModal UI 有「申請人的直屬主管（依員工卡設定）」選項，但
-- 20260519040000 把 applicant_supervisor 從 CHECK 拿掉 → 存 chain 撞
-- chk_approval_chain_steps_target_consistency 失敗。
--
-- 兩種 applicant_* 主管不一樣，UI 故意分開：
--   * applicant_supervisor   → employees.supervisor_id / reporting_to (員工卡填)
--   * applicant_dept_manager → departments.manager_id (組織圖部門設定)
-- 之前 fallback 把 applicant_supervisor 解成 dept.manager_id 是錯的，會解到別人。
--
-- 修法：
--   1. CHECK 重建加回 applicant_supervisor
--   2. resolve_chain_step_approvers 把 applicant_supervisor 分支獨立出來用
--      COALESCE(supervisor_id, reporting_to)
--   3. _employee_matches_chain_step 加 applicant_supervisor case
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. CHECK 加回 applicant_supervisor ────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.approval_chain_steps'::regclass
      AND contype = 'c'
      AND (conname LIKE '%target_type%' OR conname LIKE '%target_consistency%')
  LOOP
    EXECUTE format('ALTER TABLE public.approval_chain_steps DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT chk_approval_chain_steps_target_type
  CHECK (target_type IN (
    'fixed_emp','fixed_role','fixed_dept',
    'applicant_supervisor',
    'applicant_dept_manager','applicant_store_manager','applicant_section_supervisor',
    'specific_dept_manager','specific_store_manager','specific_section_supervisor'
  ));

ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT chk_approval_chain_steps_target_consistency
  CHECK (
    (target_type = 'fixed_emp'  AND target_emp_id  IS NOT NULL)
    OR (target_type = 'fixed_role' AND target_role_id IS NOT NULL)
    OR (target_type = 'fixed_dept' AND target_dept_id IS NOT NULL)
    OR (target_type IN ('applicant_supervisor','applicant_dept_manager','applicant_store_manager','applicant_section_supervisor'))
    OR (target_type = 'specific_dept_manager'    AND target_dept_id    IS NOT NULL)
    OR (target_type = 'specific_store_manager'   AND target_store_id   IS NOT NULL)
    OR (target_type = 'specific_section_supervisor' AND target_section_id IS NOT NULL)
  );


-- ─── 2. resolve_chain_step_approvers 拆 applicant_supervisor 出來 ────────
-- 用 COALESCE(supervisor_id, reporting_to) 解員工卡的直屬主管
CREATE OR REPLACE FUNCTION public.resolve_chain_step_approvers(
  p_chain_step_id    INT,
  p_applicant_emp_id INT
)
RETURNS TABLE (emp_id INT, emp_name TEXT, line_user_id TEXT, channel_code TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step          approval_chain_steps;
  v_app           employees;
  v_target_emp_id INT;
  v_section_id    INT;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps WHERE id = p_chain_step_id;
  IF v_step.id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;

  IF v_step.target_type = 'fixed_emp' AND v_step.target_emp_id IS NOT NULL THEN
    RETURN QUERY SELECT e.id, e.name,
      (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
      (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.id = v_step.target_emp_id AND e.status = '在職';
    RETURN;
  END IF;

  IF v_step.target_type = 'fixed_role' AND v_step.target_role_id IS NOT NULL THEN
    RETURN QUERY SELECT e.id, e.name,
      (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
      (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.role_id = v_step.target_role_id AND e.status = '在職'
        AND (v_app.organization_id IS NULL OR e.organization_id = v_app.organization_id);
    RETURN;
  END IF;

  IF v_step.target_type = 'fixed_dept' AND v_step.target_dept_id IS NOT NULL THEN
    RETURN QUERY SELECT e.id, e.name,
      (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
      (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.department_id = v_step.target_dept_id AND e.status = '在職';
    RETURN;
  END IF;

  IF v_app.id IS NULL THEN RETURN; END IF;

  -- ★ applicant_supervisor：員工卡的直屬主管（supervisor_id 優先，否則 reporting_to）
  IF v_step.target_type = 'applicant_supervisor' THEN
    v_target_emp_id := COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- applicant_dept_manager：部門 manager_id
  IF v_step.target_type = 'applicant_dept_manager' AND v_app.department_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_app.department_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_step.target_type = 'applicant_store_manager' AND v_app.store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_app.store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- applicant_section_supervisor（含 self fallback，對齊 230000）
  IF v_step.target_type = 'applicant_section_supervisor' THEN
    IF v_app.store_id IS NOT NULL THEN
      SELECT s.section_id INTO v_section_id FROM stores s WHERE s.id = v_app.store_id;
      IF v_section_id IS NOT NULL THEN
        SELECT ds.supervisor_id INTO v_target_emp_id FROM department_sections ds WHERE ds.id = v_section_id;
        IF v_target_emp_id IS NOT NULL THEN
          RETURN QUERY SELECT e.id, e.name,
            (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
            (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
            FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
          RETURN;
        END IF;
      END IF;
    END IF;
    -- fallback：申請人本人是某 section supervisor → 回傳自己（chain advance 會 self-skip）
    IF EXISTS (SELECT 1 FROM department_sections WHERE supervisor_id = v_app.id) THEN
      RETURN QUERY SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_app.id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_step.target_type = 'specific_dept_manager' AND v_step.target_dept_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_step.target_dept_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_step.target_type = 'specific_store_manager' AND v_step.target_store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_step.target_store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_step.target_type = 'specific_section_supervisor' AND v_step.target_section_id IS NOT NULL THEN
    SELECT ds.supervisor_id INTO v_target_emp_id FROM department_sections ds WHERE ds.id = v_step.target_section_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  RETURN;
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_chain_step_approvers(INT, INT) TO authenticated, anon;


-- ─── 3. _employee_matches_chain_step 加 applicant_supervisor case ────────
CREATE OR REPLACE FUNCTION public._employee_matches_chain_step(
  p_emp_id            INT,
  p_step_id           INT,
  p_applicant_emp_id  INT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step approval_chain_steps;
  v_emp  employees;
  v_app  employees;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps WHERE id = p_step_id;
  IF v_step.id IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id AND status = '在職';
  IF v_emp.id IS NULL THEN RETURN FALSE; END IF;

  IF v_step.target_type = 'fixed_emp' THEN
    RETURN v_step.target_emp_id = p_emp_id;
  ELSIF v_step.target_type = 'fixed_role' THEN
    RETURN v_step.target_role_id = v_emp.role_id;
  ELSIF v_step.target_type = 'fixed_dept' THEN
    RETURN v_step.target_dept_id = v_emp.department_id;
  END IF;

  IF p_applicant_emp_id IS NOT NULL THEN
    SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;
  END IF;

  -- ★ applicant_supervisor：員工卡 supervisor_id/reporting_to 是否 = p_emp_id
  IF v_step.target_type = 'applicant_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN COALESCE(v_app.supervisor_id, v_app.reporting_to) = p_emp_id;
  END IF;

  IF v_step.target_type = 'applicant_dept_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_app.department_id AND d.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'applicant_store_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_app.store_id AND s.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'applicant_section_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    JOIN department_sections ds ON ds.id = s.section_id
                    WHERE s.id = v_app.store_id AND ds.supervisor_id = p_emp_id);
  END IF;

  IF v_step.target_type = 'specific_dept_manager' THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_step.target_dept_id AND d.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'specific_store_manager' THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_step.target_store_id AND s.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'specific_section_supervisor' THEN
    RETURN EXISTS (SELECT 1 FROM department_sections ds
                    WHERE ds.id = v_step.target_section_id AND ds.supervisor_id = p_emp_id);
  END IF;

  RETURN FALSE;
END $$;

GRANT EXECUTE ON FUNCTION public._employee_matches_chain_step(INT, INT, INT)
  TO authenticated, anon, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
