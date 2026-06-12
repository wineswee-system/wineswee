-- ════════════════════════════════════════════════════════════════════════════
-- 新增 target_type = 'applicant_store_supervisor'
--
-- 問題：報修單「督導 驗收」步驟用 applicant_section_supervisor，
--       但 stores.section_id / department_sections.supervisor_id 未設 → 解不出人。
--
-- 新 type 邏輯：直接查 employees WHERE position='督導' AND store_id = 申請人 store
--   （比走 section table 更直接；只要員工卡 position 設好就能解）
--
-- 修改清單：
--   1. CHECK constraint 加新值
--   2. resolve_chain_step_approvers   加 IF case（incremental）
--   3. _employee_matches_chain_step   加 ELSIF case（incremental）
--   4. _employee_matches_snapshot_step 加 IF case（incremental）
--   5. resolve_snapshot_step_approvers 加 IF case（incremental）
--   6. approval_chain_steps 更新：報修表單督導步驟改為新 type
--   7. request_chain_snapshots 更新：修補目前在飛申請單的快照
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. CHECK constraint ──────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.approval_chain_steps'::regclass
       AND contype  = 'c'
       AND conname LIKE '%target_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.approval_chain_steps DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT approval_chain_steps_target_type_check CHECK (
    target_type IS NULL OR target_type IN (
      'fixed_emp','fixed_role','fixed_dept',
      'applicant_supervisor','applicant_dept_manager',
      'applicant_store_manager','applicant_store_supervisor',
      'applicant_section_supervisor',
      'specific_dept_manager','specific_store_manager','specific_section_supervisor',
      'transfer_in_store_manager','transfer_out_store_manager',
      'transfer_in_store_supervisor','transfer_out_store_supervisor',
      'warehouse_supervisor'
    )
  );

-- 同步 consistency check
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.approval_chain_steps'::regclass
       AND contype  = 'c'
       AND conname LIKE '%target_consistency%'
  LOOP
    EXECUTE format('ALTER TABLE public.approval_chain_steps DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.approval_chain_steps
  ADD CONSTRAINT chk_approval_chain_steps_target_consistency CHECK (
    target_type IS NULL
    OR (target_type = 'fixed_emp'  AND target_emp_id  IS NOT NULL)
    OR (target_type = 'fixed_role' AND target_role_id IS NOT NULL)
    OR (target_type = 'fixed_dept' AND target_dept_id IS NOT NULL)
    OR (target_type IN (
        'applicant_supervisor','applicant_dept_manager',
        'applicant_store_manager','applicant_store_supervisor',
        'applicant_section_supervisor',
        'transfer_in_store_manager','transfer_out_store_manager',
        'transfer_in_store_supervisor','transfer_out_store_supervisor',
        'warehouse_supervisor'
       ))
    OR (target_type = 'specific_dept_manager'      AND target_dept_id    IS NOT NULL)
    OR (target_type = 'specific_store_manager'     AND target_store_id   IS NOT NULL)
    OR (target_type = 'specific_section_supervisor' AND target_section_id IS NOT NULL)
  );


-- ─── 2. resolve_chain_step_approvers ─────────────────────────────────────
-- 完整重寫（20260519280000 base），加 applicant_store_supervisor case
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

  -- ★ 新增：申請人門市的督導（position='督導'）
  IF v_step.target_type = 'applicant_store_supervisor' AND v_app.store_id IS NOT NULL THEN
    RETURN QUERY SELECT e.id, e.name,
      (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
      (SELECT lt.channel_code FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e
      WHERE e.store_id = v_app.store_id
        AND e.position = '督導'
        AND e.status = '在職';
    RETURN;
  END IF;

  -- applicant_section_supervisor（含 self fallback）
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


-- ─── 3. _employee_matches_chain_step ─────────────────────────────────────
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
  -- ★ 新增
  ELSIF v_step.target_type = 'applicant_store_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (v_emp.store_id = v_app.store_id AND v_emp.position = '督導');
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


-- ─── 4. _employee_matches_snapshot_step ──────────────────────────────────
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

  -- ★ 新增
  IF v_snap.target_type = 'applicant_store_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (v_emp.store_id = v_app.store_id AND v_emp.position = '督導');
  END IF;

  IF v_snap.target_type = 'applicant_section_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM stores s
        JOIN department_sections ds ON ds.id = s.section_id
       WHERE s.id = v_app.store_id AND ds.supervisor_id = p_emp_id
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


-- ─── 5. resolve_snapshot_step_approvers ──────────────────────────────────
-- 完整重寫（20260609141000 base），加 applicant_store_supervisor case
CREATE OR REPLACE FUNCTION public.resolve_snapshot_step_approvers(
  p_request_type     TEXT,
  p_request_id       INT,
  p_step_order       INT,
  p_applicant_emp_id INT
)
RETURNS TABLE (emp_id INT, emp_name TEXT, line_user_id TEXT, channel_code TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_snap          public.request_chain_snapshots;
  v_app           employees;
  v_target_emp_id INT;
  v_section_id    INT;
  v_store_id      INT;
BEGIN
  SELECT * INTO v_snap
    FROM public.request_chain_snapshots
   WHERE request_type = p_request_type
     AND request_id   = p_request_id
     AND step_order   = p_step_order;
  IF v_snap.id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;

  -- ─────── fixed_* ───────
  IF v_snap.target_type = 'fixed_emp' AND v_snap.target_emp_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.id = v_snap.target_emp_id AND e.status = '在職';
    RETURN;
  END IF;

  IF v_snap.target_type = 'fixed_role' AND v_snap.target_role_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.role_id = v_snap.target_role_id AND e.status = '在職'
        AND (v_app.organization_id IS NULL OR e.organization_id = v_app.organization_id);
    RETURN;
  END IF;

  IF v_snap.target_type = 'fixed_dept' AND v_snap.target_dept_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.department_id = v_snap.target_dept_id AND e.status = '在職';
    RETURN;
  END IF;

  IF v_app.id IS NULL THEN RETURN; END IF;

  -- ─────── applicant_* ───────
  IF v_snap.target_type = 'applicant_supervisor' THEN
    v_target_emp_id := COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'applicant_dept_manager' AND v_app.department_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_app.department_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'applicant_store_manager' AND v_app.store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_app.store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- ★ 新增：申請人門市的督導
  IF v_snap.target_type = 'applicant_store_supervisor' AND v_app.store_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e
      WHERE e.store_id = v_app.store_id
        AND e.position = '督導'
        AND e.status = '在職';
    RETURN;
  END IF;

  -- 補回：applicant_section_supervisor
  IF v_snap.target_type = 'applicant_section_supervisor' THEN
    IF v_app.store_id IS NOT NULL THEN
      SELECT s.section_id INTO v_section_id FROM stores s WHERE s.id = v_app.store_id;
      IF v_section_id IS NOT NULL THEN
        SELECT ds.supervisor_id INTO v_target_emp_id
          FROM department_sections ds WHERE ds.id = v_section_id;
        IF v_target_emp_id IS NOT NULL THEN
          RETURN QUERY
            SELECT e.id, e.name,
              (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
              (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
            FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
        END IF;
      END IF;
    END IF;
    RETURN;
  END IF;

  -- ─────── specific_* ───────
  IF v_snap.target_type = 'specific_dept_manager' AND v_snap.target_dept_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_snap.target_dept_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'specific_store_manager' AND v_snap.target_store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_snap.target_store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- 補回：specific_section_supervisor
  IF v_snap.target_type = 'specific_section_supervisor' AND v_snap.target_section_id IS NOT NULL THEN
    SELECT ds.supervisor_id INTO v_target_emp_id
      FROM department_sections ds WHERE ds.id = v_snap.target_section_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- ─────── 商品調撥 5 個 dynamic target ───────
  IF v_snap.target_type IN ('transfer_in_store_manager', 'transfer_out_store_manager') THEN
    v_store_id := public._goods_transfer_target_store(p_request_id,
      CASE v_snap.target_type WHEN 'transfer_in_store_manager' THEN 'to' ELSE 'from' END);
    IF v_store_id IS NOT NULL THEN
      SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_store_id;
      IF v_target_emp_id IS NOT NULL THEN
        RETURN QUERY
          SELECT e.id, e.name,
            (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
            (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
          FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
      END IF;
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type IN ('transfer_in_store_supervisor', 'transfer_out_store_supervisor') THEN
    v_store_id := public._goods_transfer_target_store(p_request_id,
      CASE v_snap.target_type WHEN 'transfer_in_store_supervisor' THEN 'to' ELSE 'from' END);
    IF v_store_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e
        WHERE e.store_id = v_store_id
          AND e.position = '督導'
          AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'warehouse_supervisor' THEN
    SELECT d.manager_id INTO v_target_emp_id
      FROM departments d
     WHERE d.name = '倉儲物流部'
       AND (v_app.organization_id IS NULL OR d.organization_id = v_app.organization_id)
     LIMIT 1;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  RETURN;
END $$;


-- ─── 6. 不修改 approval_chain_steps ──────────────────────────────────────
-- 報修單督導步驟已正確設為 applicant_section_supervisor；
-- stores.section_id / department_sections.supervisor_id 資料也已設好，
-- 不需要改 target_type。
-- （此區塊保留為空，避免 idempotent rerun 出錯）


-- ─── 7. 不修補快照 ────────────────────────────────────────────────────────
-- 快照快照的 target_type 應維持 applicant_section_supervisor；
-- 若先前已被誤改為 applicant_store_supervisor，請在 Studio 手動補回：
--   UPDATE request_chain_snapshots
--   SET target_type = 'applicant_section_supervisor'
--   WHERE request_type = 'form_submission'
--     AND step_order = 3
--     AND target_type = 'applicant_store_supervisor'
--     AND request_id = (
--       SELECT id FROM form_submissions
--       WHERE template_id = (SELECT id FROM form_templates WHERE name = '門市報修申請單')
--         AND status = '申請中'
--       LIMIT 1
--     );


COMMIT;

NOTIFY pgrst, 'reload schema';
