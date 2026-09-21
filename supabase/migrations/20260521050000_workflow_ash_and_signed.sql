-- ════════════════════════════════════════════════════════════════════════════
-- workflow_instances 簽核寫入 ash + 已簽核 tab 加 workflow 類型
-- ────────────────────────────────────────────────────────────────────────────
-- workflow_instances 欄位名與其他表不同（completion_chain_id / chain_current_step /
-- chain_status），ash trigger 無法直接掛。改由 RPC 自己寫 ash。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. workflow_instance_start_chain：啟動時寫 ash 第一筆 ──────────────────
CREATE OR REPLACE FUNCTION public.workflow_instance_start_chain(
  p_instance_id INT
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inst  workflow_instances;
  v_step  approval_chain_steps;
BEGIN
  SELECT * INTO v_inst FROM workflow_instances WHERE id = p_instance_id;
  IF v_inst.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_inst.completion_chain_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_CHAIN');
  END IF;
  IF v_inst.chain_status <> '未啟動' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_STARTED',
      'chain_status', v_inst.chain_status);
  END IF;

  UPDATE workflow_instances
     SET chain_status       = '簽核中',
         chain_current_step = 0
   WHERE id = p_instance_id;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_inst.completion_chain_id AND step_order = 0;

  -- 寫入 ash 第一筆（submitted = 已遞交等待第一關）
  INSERT INTO approval_step_history (
    request_type, request_id, chain_id,
    step_order, step_label, target_type,
    entered_at, action
  ) VALUES (
    'workflow', p_instance_id, v_inst.completion_chain_id,
    0, v_step.label, v_step.target_type,
    now(), 'submitted'
  );

  RETURN json_build_object(
    'ok',               true,
    'event',            'chain_started',
    'first_step_label', v_step.label,
    'first_step_role',  v_step.role_name
  );
END $$;

GRANT EXECUTE ON FUNCTION public.workflow_instance_start_chain(INT)
  TO authenticated, anon;


-- ─── 2. workflow_instance_chain_approve：每關簽核寫 ash ──────────────────────
CREATE OR REPLACE FUNCTION public.workflow_instance_chain_approve(
  p_instance_id  INT,
  p_approver_id  INT,
  p_action       TEXT,
  p_reason       TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inst          workflow_instances;
  v_step          approval_chain_steps;
  v_total_steps   INT;
  v_is_last       BOOLEAN;
  v_next_step     approval_chain_steps;
  v_approver_name TEXT;
BEGIN
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_inst FROM workflow_instances WHERE id = p_instance_id;
  IF v_inst.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_inst.chain_status <> '簽核中' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_IN_CHAIN',
      'chain_status', v_inst.chain_status);
  END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id   = v_inst.completion_chain_id
     AND step_order = v_inst.chain_current_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
  END IF;

  IF NOT public._employee_matches_chain_step(
       p_approver_id, v_step.id, v_inst.applicant_emp_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps
   WHERE chain_id = v_inst.completion_chain_id;

  v_is_last := (v_inst.chain_current_step + 1 >= v_total_steps);

  SELECT name INTO v_approver_name FROM employees WHERE id = p_approver_id;

  -- ── 駁回 ────────────────────────────────────────────────────────────────
  IF p_action = 'reject' THEN
    UPDATE workflow_instances
       SET chain_status = '已駁回', status = '已退回'
     WHERE id = p_instance_id;

    UPDATE approval_step_history
       SET exited_at    = now(),
           action       = 'rejected',
           approver_id  = p_approver_id,
           approver_name = v_approver_name
     WHERE request_type = 'workflow'
       AND request_id   = p_instance_id
       AND step_order   = v_inst.chain_current_step
       AND exited_at IS NULL;

    RETURN json_build_object(
      'ok', true, 'status', '已退回', 'event', 'rejected',
      'rejected_at_step', v_inst.chain_current_step
    );
  END IF;

  -- ── 核准（最後一關）────────────────────────────────────────────────────
  IF v_is_last THEN
    UPDATE workflow_instances
       SET chain_status = '已核准',
           status       = '已完成',
           completed_at = NOW()
     WHERE id = p_instance_id;

    UPDATE approval_step_history
       SET exited_at    = now(),
           action       = 'approved',
           approver_id  = p_approver_id,
           approver_name = v_approver_name
     WHERE request_type = 'workflow'
       AND request_id   = p_instance_id
       AND step_order   = v_inst.chain_current_step
       AND exited_at IS NULL;

    RETURN json_build_object(
      'ok', true, 'status', '已完成', 'event', 'approved', 'is_last_step', true
    );
  END IF;

  -- ── 核准（中間關）──────────────────────────────────────────────────────
  UPDATE workflow_instances
     SET chain_current_step = chain_current_step + 1
   WHERE id = p_instance_id;

  UPDATE approval_step_history
     SET exited_at    = now(),
         action       = 'approved',
         approver_id  = p_approver_id,
         approver_name = v_approver_name
   WHERE request_type = 'workflow'
     AND request_id   = p_instance_id
     AND step_order   = v_inst.chain_current_step
     AND exited_at IS NULL;

  SELECT * INTO v_next_step FROM approval_chain_steps
   WHERE chain_id   = v_inst.completion_chain_id
     AND step_order = v_inst.chain_current_step + 1;

  INSERT INTO approval_step_history (
    request_type, request_id, chain_id,
    step_order, step_label, target_type,
    entered_at, action
  ) VALUES (
    'workflow', p_instance_id, v_inst.completion_chain_id,
    v_inst.chain_current_step + 1,
    v_next_step.label, v_next_step.target_type,
    now(), 'pending'
  );

  RETURN json_build_object(
    'ok', true, 'status', '簽核中', 'event', 'advanced',
    'advanced_to_step', v_inst.chain_current_step + 1,
    'is_last_step', false,
    'next_step_label', v_next_step.label
  );
END $$;

GRANT EXECUTE ON FUNCTION public.workflow_instance_chain_approve(INT, INT, TEXT, TEXT)
  TO authenticated, anon;


-- ─── 3. 更新 _list_my_signed_approvals：加 workflow_signed，chain_signed 加 type 過濾 ──
CREATE OR REPLACE FUNCTION public._list_my_signed_approvals(
  p_emp_id     INT,
  p_year_month TEXT
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_end   TIMESTAMPTZ;
  result  json;
BEGIN
  IF p_year_month IS NOT NULL THEN
    v_start := (p_year_month || '-01')::timestamptz;
    v_end   := v_start + INTERVAL '1 month';
  END IF;

  WITH
  -- ── chain 簽核（明確列出 request_type，排除 workflow 防重複）
  chain_signed AS (
    SELECT
      ash.request_type::text  AS source_type,
      ash.request_id          AS source_id,
      ash.action              AS my_action,
      ash.exited_at           AS signed_at,
      ash.step_order,
      ash.step_label,
      false                   AS is_extra,
      CASE ash.request_type::text
        WHEN 'leave'           THEN lr.employee
        WHEN 'overtime'        THEN orr.employee
        WHEN 'trip'            THEN bt.employee
        WHEN 'correction'      THEN cc.employee
        WHEN 'expense'         THEN ex.employee
        WHEN 'expense_request' THEN exr.employee
        WHEN 'resignation'     THEN rr_e.name
        WHEN 'loa'             THEN loa_e.name
        WHEN 'transfer'        THEN ptr_e.name
        WHEN 'headcount'       THEN hcr_e.name
        WHEN 'form_submission' THEN fs_e.name
      END AS applicant_name,
      CASE ash.request_type::text
        WHEN 'leave'           THEN lr.status
        WHEN 'overtime'        THEN orr.status
        WHEN 'trip'            THEN bt.status
        WHEN 'correction'      THEN cc.status
        WHEN 'expense'         THEN ex.status
        WHEN 'expense_request' THEN exr.status
        WHEN 'resignation'     THEN rr.status
        WHEN 'loa'             THEN loa.status
        WHEN 'transfer'        THEN ptr.status
        WHEN 'headcount'       THEN hcr.status
        WHEN 'form_submission' THEN fs.status
      END AS current_status,
      CASE ash.request_type::text
        WHEN 'leave'           THEN lr.type  || ' · ' || lr.start_date  || ' ~ ' || COALESCE(lr.end_date,  lr.start_date)::text
        WHEN 'overtime'        THEN '加班 '  || orr.date || ' (' || COALESCE(orr.hours, 0)::text || 'h)'
        WHEN 'trip'            THEN COALESCE(bt.destination, '出差') || ' · ' || bt.start_date || ' ~ ' || COALESCE(bt.end_date, bt.start_date)::text
        WHEN 'correction'      THEN COALESCE(cc.type, '補打卡') || ' · ' || cc.date
        WHEN 'expense'         THEN ex.category || ' · NT$ ' || COALESCE(ex.amount, 0)::text
        WHEN 'expense_request' THEN exr.title || ' · NT$ ' || COALESCE(exr.estimated_amount, 0)::text
        WHEN 'resignation'     THEN '離職申請 · 預計 ' || COALESCE(rr.planned_resign_date::text, '—')
        WHEN 'loa'             THEN '留停 · ' || COALESCE(loa.reason_type, '—')
        WHEN 'transfer'        THEN COALESCE(ptr.transfer_type, '異動') || ' · 生效 ' || COALESCE(ptr.effective_date::text, '—')
        WHEN 'headcount'       THEN hcr.job_title || ' × ' || hcr.headcount::text || ' 人'
        WHEN 'form_submission' THEN ft.name
      END AS summary
    FROM approval_step_history ash
    LEFT JOIN leave_requests               lr     ON ash.request_type = 'leave'           AND lr.id  = ash.request_id
    LEFT JOIN overtime_requests            orr    ON ash.request_type = 'overtime'        AND orr.id = ash.request_id
    LEFT JOIN business_trips               bt     ON ash.request_type = 'trip'            AND bt.id  = ash.request_id
    LEFT JOIN clock_corrections            cc     ON ash.request_type = 'correction'      AND cc.id  = ash.request_id
    LEFT JOIN expenses                     ex     ON ash.request_type = 'expense'         AND ex.id  = ash.request_id
    LEFT JOIN expense_requests             exr    ON ash.request_type = 'expense_request' AND exr.id = ash.request_id
    LEFT JOIN resignation_requests         rr     ON ash.request_type = 'resignation'     AND rr.id  = ash.request_id
    LEFT JOIN employees                    rr_e   ON rr.employee_id  = rr_e.id
    LEFT JOIN leave_of_absence_requests    loa    ON ash.request_type = 'loa'             AND loa.id = ash.request_id
    LEFT JOIN employees                    loa_e  ON loa.employee_id = loa_e.id
    LEFT JOIN personnel_transfer_requests  ptr    ON ash.request_type = 'transfer'        AND ptr.id = ash.request_id
    LEFT JOIN employees                    ptr_e  ON ptr.employee_id = ptr_e.id
    LEFT JOIN headcount_requests           hcr    ON ash.request_type = 'headcount'       AND hcr.id = ash.request_id
    LEFT JOIN employees                    hcr_e  ON hcr.employee_id = hcr_e.id
    LEFT JOIN form_submissions             fs     ON ash.request_type = 'form_submission' AND fs.id  = ash.request_id
    LEFT JOIN employees                    fs_e   ON fs.applicant_id = fs_e.id
    LEFT JOIN form_templates               ft     ON fs.template_id  = ft.id
    WHERE ash.approver_id = p_emp_id
      AND ash.action IN ('approved', 'rejected')
      AND ash.exited_at IS NOT NULL
      -- 明確排除 workflow，由下方 workflow_signed 處理（防止重複）
      AND ash.request_type IN (
        'leave','overtime','trip','correction','expense','expense_request',
        'resignation','loa','transfer','headcount','form_submission'
      )
      AND (p_year_month IS NULL OR (ash.exited_at >= v_start AND ash.exited_at < v_end))
  ),
  -- ── 加簽
  extra_signed AS (
    SELECT
      CASE es.source_table
        WHEN 'leave_requests'              THEN 'leave'
        WHEN 'overtime_requests'           THEN 'overtime'
        WHEN 'business_trips'              THEN 'trip'
        WHEN 'clock_corrections'           THEN 'correction'
        WHEN 'expenses'                    THEN 'expense'
        WHEN 'expense_requests'            THEN 'expense_request'
        WHEN 'resignation_requests'        THEN 'resignation'
        WHEN 'leave_of_absence_requests'   THEN 'loa'
        WHEN 'personnel_transfer_requests' THEN 'transfer'
        WHEN 'headcount_requests'          THEN 'headcount'
        WHEN 'form_submissions'            THEN 'form_submission'
        ELSE es.source_table
      END                   AS source_type,
      es.source_id          AS source_id,
      es.status             AS my_action,
      es.approved_at        AS signed_at,
      NULL::int             AS step_order,
      '加簽'                AS step_label,
      true                  AS is_extra,
      NULL::text            AS applicant_name,
      NULL::text            AS current_status,
      NULL::text            AS summary
    FROM approval_extra_steps es
    WHERE es.assignee_id = p_emp_id
      AND es.status IN ('approved', 'rejected')
      AND es.approved_at IS NOT NULL
      AND (p_year_month IS NULL OR (es.approved_at >= v_start AND es.approved_at < v_end))
  ),
  -- ── 希望休
  off_signed AS (
    SELECT
      'off_request'                        AS source_type,
      ofr.id                               AS source_id,
      CASE ofr.status WHEN '已核准' THEN 'approved' ELSE 'rejected' END AS my_action,
      ofr.approved_at                      AS signed_at,
      NULL::int                            AS step_order,
      '希望休核准'                         AS step_label,
      false                                AS is_extra,
      ofr.employee                         AS applicant_name,
      ofr.status                           AS current_status,
      ofr.employee || ' · ' || ofr.date::text AS summary
    FROM off_requests ofr
    WHERE ofr.approver_id = p_emp_id
      AND ofr.status IN ('已核准', '已駁回')
      AND ofr.approved_at IS NOT NULL
      AND (p_year_month IS NULL OR (ofr.approved_at >= v_start AND ofr.approved_at < v_end))
  ),
  -- ── 換班（主管核准）
  shift_mgr_signed AS (
    SELECT
      'shift_swap'                         AS source_type,
      ss.id                                AS source_id,
      CASE ss.status WHEN '已核准' THEN 'approved' ELSE 'rejected' END AS my_action,
      ss.approved_at                       AS signed_at,
      NULL::int                            AS step_order,
      '主管核准'                           AS step_label,
      false                                AS is_extra,
      ss.requester                         AS applicant_name,
      ss.status                            AS current_status,
      ss.requester || ' · ' || COALESCE(ss.swap_date::text, '#' || ss.id::text) AS summary
    FROM shift_swaps ss
    WHERE ss.approver_id = p_emp_id
      AND ss.status IN ('已核准', '已拒絕')
      AND ss.approved_at IS NOT NULL
      AND (p_year_month IS NULL OR (ss.approved_at >= v_start AND ss.approved_at < v_end))
  ),
  -- ── 換班（對方同意）
  shift_peer_signed AS (
    SELECT
      'shift_swap'                         AS source_type,
      ss.id                                AS source_id,
      CASE ss.peer_response WHEN '同意' THEN 'approved' ELSE 'rejected' END AS my_action,
      ss.peer_responded_at                 AS signed_at,
      NULL::int                            AS step_order,
      '對方同意'                           AS step_label,
      false                                AS is_extra,
      ss.requester                         AS applicant_name,
      ss.status                            AS current_status,
      ss.requester || ' · ' || COALESCE(ss.swap_date::text, '#' || ss.id::text) AS summary
    FROM shift_swaps ss
    WHERE ss.target_id = p_emp_id
      AND ss.peer_response IS NOT NULL
      AND ss.peer_responded_at IS NOT NULL
      AND (p_year_month IS NULL OR (ss.peer_responded_at >= v_start AND ss.peer_responded_at < v_end))
  ),
  -- ── 任務確認
  task_signed AS (
    SELECT
      'task_confirmation'                  AS source_type,
      tc.id                                AS source_id,
      tc.status                            AS my_action,
      tc.responded_at                      AS signed_at,
      tc.step_order                        AS step_order,
      '任務確認'                           AS step_label,
      false                                AS is_extra,
      t.title                              AS applicant_name,
      tc.status                            AS current_status,
      t.title                              AS summary
    FROM task_confirmations tc
    JOIN employees e ON e.name = tc.approver
    JOIN tasks     t ON t.id   = tc.task_id
    WHERE e.id = p_emp_id
      AND tc.status IN ('approved', 'rejected')
      AND tc.responded_at IS NOT NULL
      AND (p_year_month IS NULL OR (tc.responded_at >= v_start AND tc.responded_at < v_end))
  ),
  -- ── 費用核銷
  settle_signed AS (
    SELECT
      'expense_settle'                     AS source_type,
      er.id                                AS source_id,
      'approved'                           AS my_action,
      er.settled_at                        AS signed_at,
      NULL::int                            AS step_order,
      '費用核銷'                           AS step_label,
      false                                AS is_extra,
      er.employee                          AS applicant_name,
      er.status                            AS current_status,
      '核銷 ' || er.title || ' · NT$ ' || COALESCE(er.actual_amount, er.estimated_amount, 0)::text AS summary
    FROM expense_requests er
    JOIN employees e ON e.name = er.settled_by
    WHERE e.id = p_emp_id
      AND er.status = '已核銷'
      AND er.settled_at IS NOT NULL
      AND (p_year_month IS NULL OR (er.settled_at >= v_start AND er.settled_at < v_end))
  ),
  -- ── 流程完成簽核（ash 由 workflow_instance_chain_approve RPC 直接寫入）
  workflow_signed AS (
    SELECT
      'workflow'          AS source_type,
      ash.request_id      AS source_id,
      ash.action          AS my_action,
      ash.exited_at       AS signed_at,
      ash.step_order,
      ash.step_label,
      false               AS is_extra,
      wi_e.name           AS applicant_name,
      wi.chain_status     AS current_status,
      wi.template_name    AS summary
    FROM approval_step_history ash
    JOIN workflow_instances wi  ON wi.id   = ash.request_id
    LEFT JOIN employees    wi_e ON wi_e.id = wi.applicant_emp_id
    WHERE ash.request_type = 'workflow'
      AND ash.approver_id  = p_emp_id
      AND ash.action IN ('approved', 'rejected')
      AND ash.exited_at IS NOT NULL
      AND (p_year_month IS NULL OR (ash.exited_at >= v_start AND ash.exited_at < v_end))
  ),
  all_signed AS (
    SELECT * FROM chain_signed
    UNION ALL SELECT * FROM extra_signed
    UNION ALL SELECT * FROM off_signed
    UNION ALL SELECT * FROM shift_mgr_signed
    UNION ALL SELECT * FROM shift_peer_signed
    UNION ALL SELECT * FROM task_signed
    UNION ALL SELECT * FROM settle_signed
    UNION ALL SELECT * FROM workflow_signed
  )
  SELECT json_agg(json_build_object(
    'source_type',    source_type,
    'source_id',      source_id,
    'my_action',      my_action,
    'signed_at',      signed_at,
    'step_order',     step_order,
    'step_label',     step_label,
    'is_extra',       is_extra,
    'applicant_name', applicant_name,
    'current_status', current_status,
    'summary',        summary
  ) ORDER BY signed_at DESC)
  INTO result FROM all_signed;

  RETURN COALESCE(result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public._list_my_signed_approvals(INT, TEXT) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
