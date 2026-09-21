-- ════════════════════════════════════════════════════════════════════════════
-- 修「上層主管」chain step 解不出實際人名 bug
-- ────────────────────────────────────────────────────────────────────────────
-- Root cause:
--   approval_chain_steps.target_type = 'applicant_supervisor' 在 20260508080000
--   migration 已被宣告砍掉、UPDATE 過一次，但 live DB 仍有此值的 row（推測是
--   migration 後新建，繞過 CHECK 或 CHECK 沒生效）。resolve_chain_step_approvers
--   沒有 applicant_supervisor 分支 → silent 回空 → ChainTimeline 顯示
--   role_name fallback「上層主管」placeholder，沒帶出實際申請人部門主管。
--
-- 修法 (兩件)：
--   1. 把殘留的 applicant_supervisor row 一次性清成 applicant_dept_manager
--   2. resolve_chain_step_approvers 加 'applicant_supervisor' fallback 分支，
--      跟 applicant_dept_manager 走同一條解法（防老闆從 Studio 又 INSERT 進來
--      或舊 chain template 被 import 回來）
--   3. CHECK constraint 補一遍（前一個 migration 加過，這裡 idempotent 重建）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 把殘留的 applicant_supervisor → applicant_dept_manager ──────────────
UPDATE public.approval_chain_steps
   SET target_type = 'applicant_dept_manager'
 WHERE target_type = 'applicant_supervisor';


-- ─── 2. CHECK 重建（idempotent；確保 applicant_supervisor 不能再被 INSERT）──
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
    'applicant_dept_manager','applicant_store_manager','applicant_section_supervisor',
    'specific_dept_manager','specific_store_manager','specific_section_supervisor'
  ));

ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT chk_approval_chain_steps_target_consistency
  CHECK (
    (target_type = 'fixed_emp'  AND target_emp_id  IS NOT NULL)
    OR (target_type = 'fixed_role' AND target_role_id IS NOT NULL)
    OR (target_type = 'fixed_dept' AND target_dept_id IS NOT NULL)
    OR (target_type IN ('applicant_dept_manager','applicant_store_manager','applicant_section_supervisor'))
    OR (target_type = 'specific_dept_manager'    AND target_dept_id    IS NOT NULL)
    OR (target_type = 'specific_store_manager'   AND target_store_id   IS NOT NULL)
    OR (target_type = 'specific_section_supervisor' AND target_section_id IS NOT NULL)
  );


-- ─── 3. resolve_chain_step_approvers 加 applicant_supervisor 防呆分支 ──────
-- 1:1 重寫 20260508080000 版本，唯一新增是 applicant_supervisor 走跟
-- applicant_dept_manager 同樣解法（萬一又有遺漏 row 或舊 chain import 進來）
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

  -- ★ applicant_supervisor (legacy) 走 dept_manager 同樣解法（防呆）
  IF v_step.target_type IN ('applicant_dept_manager', 'applicant_supervisor')
       AND v_app.department_id IS NOT NULL THEN
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

  IF v_step.target_type = 'applicant_section_supervisor' AND v_app.store_id IS NOT NULL THEN
    SELECT s.section_id INTO v_section_id FROM stores s WHERE s.id = v_app.store_id;
    IF v_section_id IS NOT NULL THEN
      SELECT ds.supervisor_id INTO v_target_emp_id FROM department_sections ds WHERE ds.id = v_section_id;
      IF v_target_emp_id IS NOT NULL THEN
        RETURN QUERY SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
          FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
      END IF;
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

COMMIT;

NOTIFY pgrst, 'reload schema';
