-- ════════════════════════════════════════════════════════════════════════════
-- 修補：_employee_matches_chain_step / _employee_matches_snapshot_step
--       的 applicant_section_supervisor 缺 self-fallback
--
-- 症狀：課督導/經理自己申請時（store_id 指總部、section_id NULL），
--   resolve_* 已有 self-fallback 會回傳自己 → 顯示名字 OK，
--   但兩個 matching function 沒 fallback → 系統判定「這關不是你簽」→
--   待我審核裡沒有核准鈕。
--
-- 修法：section_supervisor 分支改成
--   「門市課別督導 = 我」OR
--   「門市課別解不出督導 AND 我就是申請人 AND 申請人本身是某課督導」
--   （與 resolve_*_step_approvers 的 self-fallback 一致）
--
-- 其餘 case 完全照 20260612100000 原樣搬回，只動這一段。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. _employee_matches_chain_step ─────────────────────────────────────
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

  IF v_step.target_type = 'applicant_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN COALESCE(v_app.supervisor_id, v_app.reporting_to) = p_emp_id;
  END IF;

  IF v_step.target_type = 'applicant_dept_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_app.department_id AND d.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'applicant_store_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_app.store_id AND s.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'applicant_store_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (v_emp.store_id = v_app.store_id AND v_emp.position = '督導');
  ELSIF v_step.target_type = 'applicant_section_supervisor' AND v_app.id IS NOT NULL THEN
    -- ★ 加 self-fallback：門市課別督導 = 我，或（課別解不出督導 AND 我是申請人本人 AND 我本身是某課督導）
    RETURN (
      EXISTS (SELECT 1 FROM stores s
                JOIN department_sections ds ON ds.id = s.section_id
               WHERE s.id = v_app.store_id AND ds.supervisor_id = p_emp_id)
      OR (
        p_emp_id = v_app.id
        AND NOT EXISTS (SELECT 1 FROM stores s
                          JOIN department_sections ds ON ds.id = s.section_id
                         WHERE s.id = v_app.store_id AND ds.supervisor_id IS NOT NULL)
        AND EXISTS (SELECT 1 FROM department_sections WHERE supervisor_id = v_app.id)
      )
    );
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


-- ─── 2. _employee_matches_snapshot_step ──────────────────────────────────
CREATE OR REPLACE FUNCTION public._employee_matches_snapshot_step(
  p_emp_id           INT,
  p_request_type     TEXT,
  p_request_id       INT,
  p_step_order       INT,
  p_applicant_emp_id INT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_snap  public.request_chain_snapshots;
  v_emp   employees;
  v_app   employees;
BEGIN
  SELECT * INTO v_snap
    FROM public.request_chain_snapshots
   WHERE request_type = p_request_type
     AND request_id   = p_request_id
     AND step_order   = p_step_order;
  IF v_snap.id IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id AND status = '在職';
  IF v_emp.id IS NULL THEN RETURN FALSE; END IF;

  IF v_snap.target_type = 'fixed_emp'  THEN RETURN v_snap.target_emp_id  = p_emp_id; END IF;
  IF v_snap.target_type = 'fixed_role' THEN RETURN v_snap.target_role_id = v_emp.role_id; END IF;
  IF v_snap.target_type = 'fixed_dept' THEN RETURN v_snap.target_dept_id = v_emp.department_id; END IF;

  IF p_applicant_emp_id IS NOT NULL THEN
    SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;
  END IF;

  IF v_snap.target_type = 'applicant_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN COALESCE(v_app.supervisor_id, v_app.reporting_to) = p_emp_id;
  END IF;

  IF v_snap.target_type = 'applicant_dept_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_app.department_id AND d.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'applicant_store_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_app.store_id AND s.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'applicant_store_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (v_emp.store_id = v_app.store_id AND v_emp.position = '督導');
  END IF;

  IF v_snap.target_type = 'applicant_section_supervisor' AND v_app.id IS NOT NULL THEN
    -- ★ 加 self-fallback（與 resolve_snapshot_step_approvers 一致）
    RETURN (
      EXISTS (SELECT 1 FROM stores s
                JOIN department_sections ds ON ds.id = s.section_id
               WHERE s.id = v_app.store_id AND ds.supervisor_id = p_emp_id)
      OR (
        p_emp_id = v_app.id
        AND NOT EXISTS (SELECT 1 FROM stores s
                          JOIN department_sections ds ON ds.id = s.section_id
                         WHERE s.id = v_app.store_id AND ds.supervisor_id IS NOT NULL)
        AND EXISTS (SELECT 1 FROM department_sections WHERE supervisor_id = v_app.id)
      )
    );
  END IF;

  IF v_snap.target_type = 'specific_dept_manager' THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_snap.target_dept_id AND d.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'specific_store_manager' THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_snap.target_store_id AND s.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'specific_section_supervisor' THEN
    RETURN EXISTS (SELECT 1 FROM department_sections ds
                    WHERE ds.id = v_snap.target_section_id AND ds.supervisor_id = p_emp_id);
  END IF;

  RETURN FALSE;
END $$;

GRANT EXECUTE ON FUNCTION public._employee_matches_snapshot_step(INT, TEXT, INT, INT, INT)
  TO authenticated, anon, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
