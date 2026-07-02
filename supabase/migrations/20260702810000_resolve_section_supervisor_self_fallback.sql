-- resolve_snapshot_step_approvers：補 applicant_section_supervisor 的 self-fallback
-- 2026-07-02
-- 問題：門市報修 step「督導 驗收」(applicant_section_supervisor) 已核准但顯示不出簽核人名字。
--   resolve 只走「申請人門市 → stores.section_id → 課別督導」；申請人門市(威耀總部)section_id=NULL
--   → 解不到人 → timeline 名字空白。但 matcher(_employee_matches_chain_step) 有 self-fallback，
--   所以申請人(本身是課督導)簽得下去 → 兩邊不一致。
-- 修法：resolve 補上跟 matcher 對齊的 self-fallback（申請人本身是某課督導 → 自簽），只改這一段。
-- 基底 = db-drift live 快照原封不動抽出。idempotent。

CREATE OR REPLACE FUNCTION public.resolve_snapshot_step_approvers(p_request_type text, p_request_id integer, p_step_order integer, p_applicant_emp_id integer)
 RETURNS TABLE(emp_id integer, emp_name text, line_user_id text, channel_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- ─────── applicant_supervisor L1/L2/L3 ───────
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

  -- ★ L2
  IF v_snap.target_type = 'applicant_supervisor_l2' THEN
    v_target_emp_id := COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_target_emp_id IS NOT NULL THEN
      SELECT COALESCE(e.supervisor_id, e.reporting_to) INTO v_target_emp_id
        FROM employees e WHERE e.id = v_target_emp_id;
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

  -- ★ L3
  IF v_snap.target_type = 'applicant_supervisor_l3' THEN
    v_target_emp_id := COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_target_emp_id IS NOT NULL THEN
      SELECT COALESCE(e.supervisor_id, e.reporting_to) INTO v_target_emp_id
        FROM employees e WHERE e.id = v_target_emp_id;
      IF v_target_emp_id IS NOT NULL THEN
        SELECT COALESCE(e.supervisor_id, e.reporting_to) INTO v_target_emp_id
          FROM employees e WHERE e.id = v_target_emp_id;
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

  -- ─────── 其餘 applicant_* ───────
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

  IF v_snap.target_type = 'applicant_section_supervisor' THEN
    -- 1. 申請人門市綁的課別的督導
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
          RETURN;   -- ★ 找到門市課別督導就結束
        END IF;
      END IF;
    END IF;
    -- 2. self-fallback：門市未綁課別 / 課別無督導，但申請人本身是某課督導 → 申請人自簽
    --    對齊 _employee_matches_chain_step 的 section_supervisor self case（不然簽得下去卻顯示不出人）
    IF EXISTS (SELECT 1 FROM department_sections WHERE supervisor_id = v_app.id) THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_app.id AND e.status = '在職';
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
END $function$
;

GRANT EXECUTE ON FUNCTION public.resolve_snapshot_step_approvers(TEXT, INT, INT, INT) TO authenticated, anon, service_role;
NOTIFY pgrst, 'reload schema';
