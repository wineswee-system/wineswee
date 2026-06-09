-- ════════════════════════════════════════════════════════════════════════════
-- 商品調撥 — chain target type 擴充
--
-- 新加 5 種 dynamic target type 給商品調撥用：
--   transfer_in_store_manager     — 調入門市的店長（從 to_store_id 反查）
--   transfer_out_store_manager    — 調出門市的店長（從 from_store_id 反查）
--   transfer_in_store_supervisor  — 調入門市的督導（position='督導' AND store_id=to_store_id）
--   transfer_out_store_supervisor — 調出門市的督導
--   warehouse_supervisor          — 倉儲主管（departments.name='倉儲物流部'.manager_id）
--
-- 在既有 resolve_snapshot_step_approvers 末端加新 IF 分支處理這 5 種。
-- 透過 p_request_id 反查 goods_transfer_requests 拿 from_store_id / to_store_id。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- helper：拿調撥單的 from/to store
CREATE OR REPLACE FUNCTION public._goods_transfer_target_store(
  p_request_id INT,
  p_direction  TEXT  -- 'from' or 'to'
)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_direction
    WHEN 'from' THEN from_store_id
    WHEN 'to'   THEN to_store_id
  END
  FROM goods_transfer_requests
  WHERE id = p_request_id
$$;


-- 重寫 resolve_snapshot_step_approvers 加 5 個新 case（沿用原本所有 case）
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

  -- ──── NEW：商品調撥 5 個 dynamic target ────────────────────────────────

  -- 調入店店長 / 調出店店長：從 goods_transfer_requests.to_store_id / from_store_id 取
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

  -- 調入店督導 / 調出店督導：employees.position='督導' AND store_id=該店
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

  -- 倉儲主管：departments.name='倉儲物流部'.manager_id
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


-- 同步：CHECK constraint 加新 target_type 進去（讓 chain step 可以設這些值）
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
      'applicant_supervisor','applicant_dept_manager','applicant_store_manager',
      'specific_dept_manager','specific_store_manager',
      -- 商品調撥用
      'transfer_in_store_manager','transfer_out_store_manager',
      'transfer_in_store_supervisor','transfer_out_store_supervisor',
      'warehouse_supervisor'
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
