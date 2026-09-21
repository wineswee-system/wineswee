-- ════════════════════════════════════════════════════════════════════════════
-- Chain Snapshot：送出當下鎖定簽核鏈，後續不因 chain 改動受影響
-- 2026-05-28
--
-- 根因：chain_id=9,10 被整個重建（2026-05-25），導致 13 張在飛單的
--   current_step 指向已不存在的 step_order → 所有人無法簽核，
--   前端誤顯示「簽核完成」。
--
-- 解法：
--   1. 新增 request_chain_snapshots 表：申請送出當下複製 chain steps
--   2. AFTER INSERT trigger：自動快照（expense_requests 優先）
--   3. _employee_matches_snapshot_step：approval 比對改讀快照
--   4. resolve_snapshot_step_approvers：LINE 通知 approver 解析改讀快照
--   5. get_request_chain_display_names：前端/PDF 改讀快照
--   6. expense_request_step_advance、liff_approve_request：改讀快照
--   7. _notify_expense_request_step：改讀快照
--   8. liff_get_expense_request_chain_status：改讀快照
--   9. Backfill：補齊所有在飛 expense_requests 的快照
--
-- 相容性：
--   - 沒有快照的舊單（已核准/已核銷）不受影響，功能不退化
--   - get_chain_step_display_names（舊 RPC）保留不動，新前端改呼叫
--     get_request_chain_display_names
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. 核心快照表
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.request_chain_snapshots (
  id                SERIAL PRIMARY KEY,
  request_type      TEXT NOT NULL,   -- 'expense_request' | 'leave_request' | ...
  request_id        INT  NOT NULL,
  chain_id          INT,             -- 來源 chain（資訊用，不做 FK 避免 cascade 影響）
  step_order        INT  NOT NULL,
  label             TEXT,
  role_name         TEXT,
  target_type       TEXT,
  target_emp_id     INT,
  target_role_id    INT,
  target_dept_id    INT,
  target_store_id   INT,
  target_section_id INT,
  snapshotted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_type, request_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_rcs_request
  ON public.request_chain_snapshots (request_type, request_id);

COMMENT ON TABLE public.request_chain_snapshots IS
  '申請送出當下的簽核鏈快照。後續 chain 改動不影響在飛單。';


-- ══════════════════════════════════════════════════════════════════════════
-- 2. 快照寫入 helper（供 trigger + backfill 共用）
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._snapshot_chain_for_request(
  p_request_type TEXT,
  p_request_id   INT,
  p_chain_id     INT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_chain_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.request_chain_snapshots (
    request_type, request_id, chain_id, step_order,
    label, role_name, target_type,
    target_emp_id, target_role_id, target_dept_id,
    target_store_id, target_section_id
  )
  SELECT
    p_request_type, p_request_id, p_chain_id, cs.step_order,
    cs.label, cs.role_name, cs.target_type,
    cs.target_emp_id, cs.target_role_id, cs.target_dept_id,
    cs.target_store_id, cs.target_section_id
  FROM public.approval_chain_steps cs
  WHERE cs.chain_id = p_chain_id
  ORDER BY cs.step_order
  ON CONFLICT (request_type, request_id, step_order) DO NOTHING;
END $$;

GRANT EXECUTE ON FUNCTION public._snapshot_chain_for_request(TEXT, INT, INT)
  TO authenticated, service_role;


-- ══════════════════════════════════════════════════════════════════════════
-- 3. AFTER INSERT trigger：expense_requests 送出自動快照
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_snapshot_expense_request_chain()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._snapshot_chain_for_request(
    'expense_request', NEW.id, NEW.approval_chain_id
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_snapshot_expense_request_chain ON public.expense_requests;
CREATE TRIGGER trg_snapshot_expense_request_chain
  AFTER INSERT ON public.expense_requests
  FOR EACH ROW
  WHEN (NEW.approval_chain_id IS NOT NULL)
  EXECUTE FUNCTION public._trg_snapshot_expense_request_chain();


-- ══════════════════════════════════════════════════════════════════════════
-- 4. _employee_matches_snapshot_step：讀快照比對（取代 _employee_matches_chain_step）
-- ══════════════════════════════════════════════════════════════════════════
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

  -- ── fixed 系列 ──
  IF v_snap.target_type = 'fixed_emp'  THEN RETURN v_snap.target_emp_id  = p_emp_id; END IF;
  IF v_snap.target_type = 'fixed_role' THEN RETURN v_snap.target_role_id = v_emp.role_id; END IF;
  IF v_snap.target_type = 'fixed_dept' THEN RETURN v_snap.target_dept_id = v_emp.department_id; END IF;

  -- ── applicant_* 系列（需要 applicant row）──
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

  IF v_snap.target_type = 'applicant_section_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM stores s
        JOIN department_sections ds ON ds.id = s.section_id
       WHERE s.id = v_app.store_id AND ds.supervisor_id = p_emp_id
    );
  END IF;

  -- ── specific_* 系列 ──
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


-- ══════════════════════════════════════════════════════════════════════════
-- 5. resolve_snapshot_step_approvers：讀快照解析 approver（供通知 + 顯示）
-- ══════════════════════════════════════════════════════════════════════════
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
          RETURN;
        END IF;
      END IF;
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
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_snapshot_step_approvers(TEXT, INT, INT, INT)
  TO authenticated, anon, service_role;


-- ══════════════════════════════════════════════════════════════════════════
-- 6. get_request_chain_display_names：前端 / PDF 改讀快照
--    與舊 get_chain_step_display_names 介面相容，多了 request_type + request_id
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_request_chain_display_names(
  p_request_type     TEXT,
  p_request_id       INT,
  p_applicant_emp_id INT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSON;
BEGIN
  -- 有快照 → 讀快照
  IF EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = p_request_type AND request_id = p_request_id
  ) THEN
    SELECT json_agg(
      json_build_object(
        'step_order',    s.step_order,
        'label',         COALESCE(s.label, s.role_name, '第' || (s.step_order + 1) || '關'),
        'role_name',     s.role_name,
        'target_type',   s.target_type,
        'target_emp_id', s.target_emp_id,
        'names', (
          SELECT string_agg(a.emp_name, '、' ORDER BY a.emp_name)
          FROM public.resolve_snapshot_step_approvers(
            p_request_type, p_request_id, s.step_order,
            COALESCE(p_applicant_emp_id, 0)
          ) a
        )
      ) ORDER BY s.step_order
    )
    INTO v_result
    FROM public.request_chain_snapshots s
    WHERE s.request_type = p_request_type AND s.request_id = p_request_id;

    RETURN COALESCE(v_result, '[]'::json);
  END IF;

  -- 沒快照（舊單）→ 回傳空，讓前端 fallback 到舊 RPC
  RETURN '[]'::json;
END $$;

GRANT EXECUTE ON FUNCTION public.get_request_chain_display_names(TEXT, INT, INT)
  TO authenticated, anon, service_role;


-- ══════════════════════════════════════════════════════════════════════════
-- 7. _notify_expense_request_step：改讀快照
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._notify_expense_request_step(
  p_request_id  INT,
  p_step_order  INT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req   expense_requests;
  v_count INT := 0;
  v_line  RECORD;
BEGIN
  SELECT * INTO v_req FROM expense_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RETURN 0; END IF;

  -- ── 有快照 → 讀快照解析 approver ──
  IF EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = 'expense_request' AND request_id = p_request_id
       AND step_order = p_step_order
  ) THEN
    FOR v_line IN
      SELECT DISTINCT v.line_user_id, v.liff_id
        FROM public.resolve_snapshot_step_approvers(
          'expense_request', p_request_id, p_step_order, v_req.employee_id
        ) a
        JOIN public.v_employee_line_resolved v ON v.employee_id = a.emp_id
                                               AND v.line_user_id = a.line_user_id
       WHERE v.line_user_id IS NOT NULL
    LOOP
      PERFORM public._push_expense_request_flex(
        v_line.line_user_id, v_line.liff_id, v_req.id, 'step_assigned'
      );
      v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
  END IF;

  -- ── fallback：沒快照則讀 live chain（舊單相容）──
  IF v_req.approval_chain_id IS NULL THEN RETURN 0; END IF;
  DECLARE
    v_step approval_chain_steps;
  BEGIN
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_req.approval_chain_id AND step_order = p_step_order;
    IF v_step.id IS NULL THEN RETURN 0; END IF;

    FOR v_line IN
      SELECT DISTINCT v.line_user_id, v.liff_id
        FROM public.resolve_chain_step_approvers(v_step.id, v_req.employee_id) a
        JOIN public.v_employee_line_resolved v ON v.employee_id = a.emp_id
                                               AND v.line_user_id = a.line_user_id
       WHERE v.line_user_id IS NOT NULL
    LOOP
      PERFORM public._push_expense_request_flex(
        v_line.line_user_id, v_line.liff_id, v_req.id, 'step_assigned'
      );
      v_count := v_count + 1;
    END LOOP;
  END;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public._notify_expense_request_step(INT, INT)
  TO authenticated, service_role;


-- ══════════════════════════════════════════════════════════════════════════
-- 8. expense_request_step_advance：改讀快照
--    完整版（對齊 20260521020000，只改 chain step 讀取部分）
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.expense_request_step_advance(
  p_id     INT,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_emp          employees;
  v_req          expense_requests;
  v_total_steps  INT;
  v_matches      boolean;
  v_extra        approval_extra_steps;
  v_has_snapshot boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = p_id;
  IF v_req.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_req.status NOT IN ('申請中', '待審') THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING', 'current_status', v_req.status);
  END IF;

  -- 加簽 guard
  v_extra := public.get_pending_extra_step('expense_requests', p_id, COALESCE(v_req.current_step, 0));
  IF v_extra.id IS NOT NULL THEN
    RETURN json_build_object(
      'ok', false, 'error', 'PENDING_EXTRA_SIGNER',
      'extra_step_id', v_extra.id,
      'extra_assignee_id', v_extra.assignee_id,
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
    );
  END IF;

  -- 沒綁 chain → 舊行為
  IF v_req.approval_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      UPDATE expense_requests SET
        status = '已核准', approved_by = v_emp.name, approved_at = NOW()
      WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'fully_approved', true);
    ELSE
      UPDATE expense_requests SET
        status = '已駁回', reject_reason = p_reason,
        approved_by = v_emp.name, approved_at = NOW()
      WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回');
    END IF;
  END IF;

  -- ── 讀快照（優先）or live chain（fallback）──
  SELECT EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = 'expense_request' AND request_id = p_id
  ) INTO v_has_snapshot;

  IF v_has_snapshot THEN
    -- 確認 current step 在快照裡存在
    IF NOT EXISTS (
      SELECT 1 FROM public.request_chain_snapshots
       WHERE request_type = 'expense_request' AND request_id = p_id
         AND step_order = v_req.current_step
    ) THEN
      RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND',
        'current_step', v_req.current_step, 'source', 'snapshot');
    END IF;

    -- 比對：此人是否為當前關的 approver
    SELECT public._employee_matches_snapshot_step(
      v_emp.id, 'expense_request', p_id, v_req.current_step, v_req.employee_id
    ) INTO v_matches;

    -- step 總數（從快照算）
    SELECT COUNT(*) INTO v_total_steps
      FROM public.request_chain_snapshots
     WHERE request_type = 'expense_request' AND request_id = p_id;

  ELSE
    -- fallback：live chain（舊單）
    DECLARE v_step approval_chain_steps; BEGIN
      SELECT * INTO v_step FROM approval_chain_steps
       WHERE chain_id = v_req.approval_chain_id AND step_order = v_req.current_step;
      IF v_step.id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND',
          'current_step', v_req.current_step, 'source', 'live_chain');
      END IF;
      SELECT public._employee_matches_chain_step(v_emp.id, v_step.id, v_req.employee_id)
        INTO v_matches;
    END;
    SELECT COUNT(*) INTO v_total_steps
      FROM approval_chain_steps WHERE chain_id = v_req.approval_chain_id;
  END IF;

  IF NOT v_matches THEN
    RETURN json_build_object(
      'ok', false, 'error', 'NOT_AUTHORIZED_FOR_STEP',
      'current_step', v_req.current_step
    );
  END IF;

  IF p_action = 'reject' THEN
    UPDATE expense_requests SET
      status = '已駁回', reject_reason = p_reason,
      approved_by = v_emp.name, approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'rejected_at_step', v_req.current_step);
  END IF;

  -- approve：最後一關 → 核准；其他 → 推進
  IF v_req.current_step + 1 >= v_total_steps THEN
    UPDATE expense_requests SET
      status = '已核准', current_step = v_total_steps,
      approved_by = v_emp.name, approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'fully_approved', true,
                             'advanced_to_step', v_total_steps);
  ELSE
    UPDATE expense_requests SET
      current_step = current_step + 1,
      approved_by = v_emp.name
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '簽核中', 'fully_approved', false,
                             'advanced_to_step', v_req.current_step + 1);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.expense_request_step_advance(INT, TEXT, TEXT) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════
-- 9. liff_approve_request：expense_request 分支改讀快照
--    完整版（對齊 20260512100000_relock 版本，只改 expense_request 分支）
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.liff_approve_request(
  p_line_user_id TEXT,
  p_type         TEXT,
  p_id           INT,
  p_action       TEXT,
  p_reason       TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp               employees;
  v_app_emp_id      INT;
  v_app_name        TEXT;
  v_app_org         INT;
  v_eligible        BOOLEAN;
  reject_val        text;
  approve_status    text;
  reject_status     text;
  result_status     text;
  v_er              record;
  v_total_steps     int;
  v_is_last         boolean;
  v_next_approver_ids INT[];
  v_next_approvers  JSON;
  v_has_snapshot    boolean;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  reject_val := CASE WHEN p_action = 'reject' THEN btrim(p_reason) ELSE NULL END;

  -- ════ HR 類（leave/overtime/trip/correction/expense）————不動 ════
  IF p_type IN ('leave','overtime','trip','correction','expense') THEN
    IF p_type = 'leave' THEN
      SELECT employee_id, employee, organization_id INTO v_app_emp_id, v_app_name, v_app_org
        FROM leave_requests WHERE id = p_id AND status = '待審核';
    ELSIF p_type = 'overtime' THEN
      SELECT employee_id, employee, organization_id INTO v_app_emp_id, v_app_name, v_app_org
        FROM overtime_requests WHERE id = p_id AND status = '待審核';
    ELSIF p_type = 'trip' THEN
      SELECT NULL::INT, employee, organization_id INTO v_app_emp_id, v_app_name, v_app_org
        FROM business_trips WHERE id = p_id AND status = '待審核';
    ELSIF p_type = 'correction' THEN
      SELECT NULL::INT, employee, NULL::INT INTO v_app_emp_id, v_app_name, v_app_org
        FROM clock_corrections WHERE id = p_id AND status = '待審核';
    ELSE
      SELECT NULL::INT, employee, NULL::INT INTO v_app_emp_id, v_app_name, v_app_org
        FROM expenses WHERE id = p_id AND status = '待審核';
    END IF;

    IF v_app_name IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;
    IF v_app_emp_id IS NULL THEN
      SELECT id INTO v_app_emp_id FROM employees
       WHERE name = v_app_name AND organization_id = COALESCE(v_app_org, emp.organization_id) LIMIT 1;
    END IF;
    IF v_app_emp_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'APPLICANT_NOT_FOUND');
    END IF;
    IF v_app_org IS NOT NULL AND v_app_org <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public._resolve_hr_approver_ids(v_app_emp_id) WHERE _resolve_hr_approver_ids = emp.id
    ) INTO v_eligible;
    IF NOT v_eligible THEN RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN'); END IF;

    approve_status := CASE p_type WHEN 'expense' THEN '已核銷' ELSE '已核准' END;
    reject_status  := '已退回';
    result_status  := CASE p_action WHEN 'approve' THEN approve_status ELSE reject_status END;

    IF p_type = 'leave' THEN
      UPDATE leave_requests SET status = result_status, approver = emp.name, reject_reason = reject_val WHERE id = p_id;
    ELSIF p_type = 'overtime' THEN
      UPDATE overtime_requests SET status = result_status, approver = emp.name, reject_reason = reject_val WHERE id = p_id;
    ELSIF p_type = 'trip' THEN
      UPDATE business_trips SET status = result_status, approver = emp.name, reject_reason = reject_val WHERE id = p_id;
    ELSIF p_type = 'correction' THEN
      UPDATE clock_corrections SET status = result_status, approver = emp.name, reject_reason = reject_val WHERE id = p_id;
    ELSE
      UPDATE expenses SET status = result_status, approver = emp.name, reject_reason = reject_val WHERE id = p_id;
    END IF;

    RETURN json_build_object('ok', true, 'status', result_status,
      'event', CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
      'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
  END IF;

  -- ════ expense_request：走 chain（改讀快照）════
  IF p_type = 'expense_request' THEN
    SELECT * INTO v_er FROM expense_requests WHERE id = p_id;
    IF v_er.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;
    IF v_er.status <> '申請中' THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;
    IF v_er.organization_id IS NOT NULL AND v_er.organization_id <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;
    IF v_er.approval_chain_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NO_CHAIN_ATTACHED');
    END IF;

    -- 決定讀快照還是 live chain
    SELECT EXISTS (
      SELECT 1 FROM public.request_chain_snapshots
       WHERE request_type = 'expense_request' AND request_id = p_id
    ) INTO v_has_snapshot;

    IF v_has_snapshot THEN
      -- 確認 current step 存在於快照
      IF NOT EXISTS (
        SELECT 1 FROM public.request_chain_snapshots
         WHERE request_type = 'expense_request' AND request_id = p_id
           AND step_order = v_er.current_step
      ) THEN
        RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND', 'source', 'snapshot');
      END IF;

      -- 比對
      IF NOT public._employee_matches_snapshot_step(
        emp.id, 'expense_request', p_id, v_er.current_step, v_er.employee_id
      ) THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
      END IF;

      SELECT COUNT(*) INTO v_total_steps
        FROM public.request_chain_snapshots
       WHERE request_type = 'expense_request' AND request_id = p_id;

    ELSE
      -- fallback：live chain
      DECLARE v_cur_step approval_chain_steps; BEGIN
        SELECT * INTO v_cur_step FROM approval_chain_steps
         WHERE chain_id = v_er.approval_chain_id AND step_order = v_er.current_step;
        IF v_cur_step.id IS NULL THEN
          RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND', 'source', 'live_chain');
        END IF;
        IF NOT public._employee_matches_chain_step(emp.id, v_cur_step.id, v_er.employee_id) THEN
          RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
        END IF;
      END;
      SELECT COUNT(*) INTO v_total_steps
        FROM approval_chain_steps WHERE chain_id = v_er.approval_chain_id;
    END IF;

    v_is_last := (v_er.current_step + 1 >= v_total_steps);

    IF p_action = 'reject' THEN
      UPDATE expense_requests SET
        status = '已退回', reject_reason = reject_val, approved_by = emp.name
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已退回', 'event', 'rejected',
        'rejected_at_step', v_er.current_step,
        'applicant', json_build_object('emp_id', v_er.employee_id, 'name', v_er.employee));
    END IF;

    IF v_is_last THEN
      UPDATE expense_requests SET
        status = '已核准', approved_by = emp.name, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved',
        'is_last_step', true,
        'applicant', json_build_object('emp_id', v_er.employee_id, 'name', v_er.employee));
    ELSE
      UPDATE expense_requests SET current_step = current_step + 1 WHERE id = p_id;

      -- 下一關 approvers（快照解析）
      IF v_has_snapshot THEN
        SELECT json_agg(json_build_object('emp_id', a.emp_id, 'name', a.emp_name))
          INTO v_next_approvers
          FROM public.resolve_snapshot_step_approvers(
            'expense_request', p_id, v_er.current_step + 1, v_er.employee_id
          ) a;
      ELSE
        DECLARE v_next_step approval_chain_steps; BEGIN
          SELECT * INTO v_next_step FROM approval_chain_steps
           WHERE chain_id = v_er.approval_chain_id AND step_order = v_er.current_step + 1;
          SELECT json_agg(json_build_object('emp_id', a.emp_id, 'name', a.emp_name))
            INTO v_next_approvers
            FROM public.resolve_chain_step_approvers(v_next_step.id, v_er.employee_id) a;
        END;
      END IF;

      RETURN json_build_object('ok', true, 'status', '簽核中', 'event', 'advanced',
        'advanced_to_step', v_er.current_step + 1, 'is_last_step', false,
        'next_approvers', COALESCE(v_next_approvers, '[]'::json),
        'applicant', json_build_object('emp_id', v_er.employee_id, 'name', v_er.employee));
    END IF;
  END IF;

  RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
END $$;

GRANT EXECUTE ON FUNCTION public.liff_approve_request(TEXT, TEXT, INT, TEXT, TEXT) TO authenticated, anon;


-- ══════════════════════════════════════════════════════════════════════════
-- 10. liff_get_expense_request_chain_status：改讀快照
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.liff_get_expense_request_chain_status(
  p_id INT
) RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_record RECORD;
  v_result JSON;
BEGIN
  SELECT id, approval_chain_id, current_step, status, reject_reason, employee_id
    INTO v_record FROM expense_requests WHERE id = p_id;
  IF v_record.id IS NULL THEN RETURN '[]'::json; END IF;

  -- 有快照 → 讀快照
  IF EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = 'expense_request' AND request_id = p_id
  ) THEN
    SELECT json_agg(
      json_build_object(
        'step_order', s.step_order,
        'label',      COALESCE(s.label, s.role_name, '第' || (s.step_order + 1) || '關'),
        'name', (
          SELECT string_agg(a.emp_name, '、' ORDER BY a.emp_name)
          FROM public.resolve_snapshot_step_approvers(
            'expense_request', p_id, s.step_order, v_record.employee_id
          ) a
        ),
        'status', (
          CASE
            WHEN v_record.status = '已退回' AND s.step_order = v_record.current_step THEN 'rejected'
            WHEN v_record.status IN ('已核銷','已核准') THEN 'completed'
            WHEN s.step_order < v_record.current_step THEN 'completed'
            WHEN s.step_order = v_record.current_step AND v_record.status = '申請中' THEN 'current'
            ELSE 'pending'
          END
        ),
        'reject_reason', (
          CASE WHEN v_record.status = '已退回' AND s.step_order = v_record.current_step
               THEN v_record.reject_reason ELSE NULL END
        )
      ) ORDER BY s.step_order
    )
    INTO v_result
    FROM public.request_chain_snapshots s
    WHERE s.request_type = 'expense_request' AND s.request_id = p_id;

    RETURN COALESCE(v_result, '[]'::json);
  END IF;

  -- fallback：live chain（舊單）
  IF v_record.approval_chain_id IS NULL THEN RETURN '[]'::json; END IF;
  SELECT json_agg(
    json_build_object(
      'step_order', s.step_order,
      'label',      COALESCE(s.label, s.role_name, '第' || (s.step_order + 1) || '關'),
      'name',       public._chain_step_display_names(s.id, v_record.employee_id),
      'status', (
        CASE
          WHEN v_record.status = '已退回' AND s.step_order = v_record.current_step THEN 'rejected'
          WHEN v_record.status IN ('已核銷','已核准') THEN 'completed'
          WHEN s.step_order < v_record.current_step THEN 'completed'
          WHEN s.step_order = v_record.current_step AND v_record.status = '申請中' THEN 'current'
          ELSE 'pending'
        END
      ),
      'reject_reason', (
        CASE WHEN v_record.status = '已退回' AND s.step_order = v_record.current_step
             THEN v_record.reject_reason ELSE NULL END
      )
    ) ORDER BY s.step_order
  )
  INTO v_result
  FROM approval_chain_steps s WHERE s.chain_id = v_record.approval_chain_id;

  RETURN COALESCE(v_result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_expense_request_chain_status(INT) TO anon, authenticated;


-- ══════════════════════════════════════════════════════════════════════════
-- 11. Backfill：補齊所有在飛 expense_requests 的快照
--     只補沒有快照的單；已核准/已核銷不管（不影響功能）
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_row expense_requests;
BEGIN
  FOR v_row IN
    SELECT * FROM expense_requests
     WHERE approval_chain_id IS NOT NULL
       AND status IN ('申請中','待審')
       AND NOT EXISTS (
         SELECT 1 FROM public.request_chain_snapshots
          WHERE request_type = 'expense_request' AND request_id = expense_requests.id
       )
  LOOP
    PERFORM public._snapshot_chain_for_request(
      'expense_request', v_row.id, v_row.approval_chain_id
    );
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 12. Guard trigger：防止有在飛單時修改 approval_chain_steps
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._guard_chain_steps_in_flight()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_count INT;
  v_tables TEXT[] := ARRAY[
    'expense_requests', 'leave_requests', 'overtime_requests',
    'business_trips', 'clock_corrections', 'resignation_requests',
    'leave_of_absence_requests', 'personnel_transfer_requests', 'headcount_requests'
  ];
  v_table TEXT;
  v_sql TEXT;
BEGIN
  v_count := 0;
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM public.%I WHERE approval_chain_id = $1 AND status IN (''申請中'',''待審'',''待審核'')',
      v_table
    ) USING OLD.chain_id INTO v_count;
    IF v_count > 0 THEN
      RAISE EXCEPTION
        'Chain % 有 % 張在飛單（表：%），請先等這些單完成或手動處理後再修改簽核流程',
        OLD.chain_id, v_count, v_table
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- form_submissions 透過 form_templates.approval_chain_id
  SELECT COUNT(*) INTO v_count
    FROM public.form_submissions fs
    JOIN public.form_templates ft ON ft.id = fs.template_id
   WHERE ft.approval_chain_id = OLD.chain_id
     AND fs.status IN ('申請中','待審','待審核','pending');
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Chain % 有 % 張在飛的 form_submissions，請先等完成後再修改',
      OLD.chain_id, v_count
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_guard_chain_steps_delete ON public.approval_chain_steps;
CREATE TRIGGER trg_guard_chain_steps_delete
  BEFORE DELETE ON public.approval_chain_steps
  FOR EACH ROW EXECUTE FUNCTION public._guard_chain_steps_in_flight();

DROP TRIGGER IF EXISTS trg_guard_chain_steps_update ON public.approval_chain_steps;
CREATE TRIGGER trg_guard_chain_steps_update
  BEFORE UPDATE OF step_order, target_type, target_emp_id, target_role_id,
                   target_dept_id, target_store_id, target_section_id
  ON public.approval_chain_steps
  FOR EACH ROW EXECUTE FUNCTION public._guard_chain_steps_in_flight();


COMMIT;
NOTIFY pgrst, 'reload schema';
