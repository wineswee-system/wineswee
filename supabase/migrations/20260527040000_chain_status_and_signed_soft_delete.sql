-- ============================================================================
-- chain_status + signed_approvals + form_submission_chain_approve 加 deleted_at — Batch 3
-- ============================================================================
--
-- 處理剩下 4 個 RPC：
--   1. _list_my_signed_approvals (helper) — 已簽過列表，已刪 row 過濾
--   2. liff_get_expense_request_chain_status — expense_requests.deleted_at
--   3. liff_get_expense_settle_chain_status — 同
--   4. form_submission_chain_approve — form_submissions.deleted_at
-- ============================================================================


-- ── 1. _list_my_signed_approvals — 已簽過列表 ────────────────────────────────
-- chain_signed CTE 內 LEFT JOIN 多個 soft-delete 表，WHERE 加判斷：
-- 若該 request_type 對應的 row 已被軟刪，不顯示
CREATE OR REPLACE FUNCTION public._list_my_signed_approvals(
  p_emp_id integer, p_year_month text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
      AND ash.request_type IN (
        'leave','overtime','trip','correction','expense','expense_request',
        'resignation','loa','transfer','headcount','form_submission'
      )
      AND (p_year_month IS NULL OR (ash.exited_at >= v_start AND ash.exited_at < v_end))
      -- ★ soft-delete filter：對應 request_type 的 row 若已軟刪則不顯示
      AND (
        CASE ash.request_type::text
          WHEN 'leave'           THEN lr.deleted_at IS NULL
          WHEN 'overtime'        THEN orr.deleted_at IS NULL
          WHEN 'trip'            THEN bt.deleted_at IS NULL
          WHEN 'correction'      THEN cc.deleted_at IS NULL
          WHEN 'expense_request' THEN exr.deleted_at IS NULL
          WHEN 'headcount'       THEN hcr.deleted_at IS NULL
          WHEN 'form_submission' THEN fs.deleted_at IS NULL
          ELSE TRUE
        END
      )
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
      AND ofr.deleted_at IS NULL  -- ★ soft-delete filter
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
      AND ss.deleted_at IS NULL  -- ★ soft-delete filter
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
      AND ss.deleted_at IS NULL  -- ★ soft-delete filter
      AND (p_year_month IS NULL OR (ss.peer_responded_at >= v_start AND ss.peer_responded_at < v_end))
  ),
  -- ── 任務確認 (tasks 沒 deleted_at 跳過)
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
      AND er.deleted_at IS NULL  -- ★ soft-delete filter
      AND (p_year_month IS NULL OR (er.settled_at >= v_start AND er.settled_at < v_end))
  ),
  -- ── 流程完成簽核（workflow_instances 沒 deleted_at 跳過）
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
END
$$;


-- ── 2. liff_get_expense_request_chain_status — expense_requests 加 deleted_at
CREATE OR REPLACE FUNCTION public.liff_get_expense_request_chain_status(p_id integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_record  RECORD;
  v_result  JSON;
BEGIN
  SELECT id, approval_chain_id, current_step, status, reject_reason, employee_id, organization_id
    INTO v_record
    FROM expense_requests
   WHERE id = p_id
     AND deleted_at IS NULL;  -- ★ soft-delete filter

  IF v_record.id IS NULL OR v_record.approval_chain_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  WITH chain_rows AS (
    SELECT
      s.step_order::numeric                                            AS sort_key,
      s.step_order                                                     AS step_order,
      'chain'::text                                                    AS kind,
      COALESCE(s.label, s.role_name, '第' || (s.step_order + 1) || '關') AS label,
      public._chain_step_display_names(s.id, v_record.employee_id)     AS name,
      CASE
        WHEN v_record.status = '已退回'        AND s.step_order = v_record.current_step THEN 'rejected'
        WHEN v_record.status IN ('已核銷','已核准')                                       THEN 'completed'
        WHEN s.step_order < v_record.current_step                                         THEN 'completed'
        WHEN s.step_order = v_record.current_step AND v_record.status = '申請中'         THEN 'current'
        ELSE 'pending'
      END                                                              AS status,
      CASE
        WHEN v_record.status = '已退回' AND s.step_order = v_record.current_step
          THEN v_record.reject_reason
        ELSE NULL
      END                                                              AS reject_reason
    FROM approval_chain_steps s
    WHERE s.chain_id = v_record.approval_chain_id
  ),
  extra_rows AS (
    SELECT
      (es.insert_before_step - 0.5)::numeric                           AS sort_key,
      es.insert_before_step                                            AS step_order,
      'extra'::text                                                    AS kind,
      '🪶 加簽'::text                                                  AS label,
      COALESCE(
        (SELECT name FROM employees WHERE id = es.assignee_id LIMIT 1),
        ''
      )                                                                AS name,
      CASE es.status
        WHEN 'pending'  THEN 'current'
        WHEN 'approved' THEN 'completed'
        WHEN 'rejected' THEN 'rejected'
      END                                                              AS status,
      es.reject_reason                                                 AS reject_reason
    FROM approval_extra_steps es
    WHERE es.source_table = 'expense_requests'
      AND es.source_id   = v_record.id
      AND es.status     <> 'cancelled'
  ),
  all_rows AS (
    SELECT * FROM chain_rows
    UNION ALL
    SELECT * FROM extra_rows
  )
  SELECT json_agg(
    json_build_object(
      'step_order',    step_order,
      'kind',          kind,
      'label',         label,
      'name',          name,
      'status',        status,
      'reject_reason', reject_reason
    ) ORDER BY sort_key
  )
  INTO v_result
  FROM all_rows;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;


-- ── 3. liff_get_expense_settle_chain_status — 同 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_get_expense_settle_chain_status(p_id integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_record  RECORD;
  v_result  JSON;
BEGIN
  SELECT id, settle_chain_id, settle_current_step, status, settle_reject_reason, employee_id, organization_id
    INTO v_record
    FROM expense_requests
   WHERE id = p_id
     AND deleted_at IS NULL;  -- ★ soft-delete filter

  IF v_record.id IS NULL OR v_record.settle_chain_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  WITH chain_rows AS (
    SELECT
      s.step_order::numeric                                            AS sort_key,
      s.step_order                                                     AS step_order,
      'chain'::text                                                    AS kind,
      COALESCE(s.label, s.role_name, '第' || (s.step_order + 1) || '關') AS label,
      public._chain_step_display_names(s.id, v_record.employee_id)     AS name,
      CASE
        WHEN v_record.status = '核銷已退回' AND s.step_order = v_record.settle_current_step THEN 'rejected'
        WHEN v_record.status = '已核銷'                                                       THEN 'completed'
        WHEN s.step_order < v_record.settle_current_step                                       THEN 'completed'
        WHEN s.step_order = v_record.settle_current_step AND v_record.status = '待核銷'      THEN 'current'
        ELSE 'pending'
      END                                                              AS status,
      CASE
        WHEN v_record.status = '核銷已退回' AND s.step_order = v_record.settle_current_step
          THEN v_record.settle_reject_reason
        ELSE NULL
      END                                                              AS reject_reason
    FROM approval_chain_steps s
    WHERE s.chain_id = v_record.settle_chain_id
  ),
  extra_rows AS (
    SELECT
      (es.insert_before_step - 0.5)::numeric                           AS sort_key,
      es.insert_before_step                                            AS step_order,
      'extra'::text                                                    AS kind,
      '🪶 加簽'::text                                                  AS label,
      COALESCE(
        (SELECT name FROM employees WHERE id = es.assignee_id LIMIT 1),
        ''
      )                                                                AS name,
      CASE es.status
        WHEN 'pending'  THEN 'current'
        WHEN 'approved' THEN 'completed'
        WHEN 'rejected' THEN 'rejected'
      END                                                              AS status,
      es.reject_reason                                                 AS reject_reason
    FROM approval_extra_steps es
    WHERE es.source_table = 'expense_settle'
      AND es.source_id   = v_record.id
      AND es.status     <> 'cancelled'
  ),
  all_rows AS (
    SELECT * FROM chain_rows
    UNION ALL
    SELECT * FROM extra_rows
  )
  SELECT json_agg(
    json_build_object(
      'step_order',    step_order,
      'kind',          kind,
      'label',         label,
      'name',          name,
      'status',        status,
      'reject_reason', reject_reason
    ) ORDER BY sort_key
  )
  INTO v_result
  FROM all_rows;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;


-- ── 4. form_submission_chain_approve — form_submissions 加 deleted_at ────────
-- ⚠️ DEFAULT 子句必須帶上（遠端原本就有），否則 CREATE OR REPLACE 會被 PG 拒絕
--    (SQLSTATE 42P13: cannot remove parameter defaults from existing function)
CREATE OR REPLACE FUNCTION public.form_submission_chain_approve(
  p_id integer,
  p_approver_id integer,
  p_action text,
  p_reason text DEFAULT NULL,
  p_reject_attachments jsonb DEFAULT '[]'::jsonb
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub         form_submissions;
  v_template    form_templates;
  v_chain_id    INT;
  v_step        approval_chain_steps;
  v_total_steps INT;
  v_is_last     BOOLEAN;
  v_next_step   approval_chain_steps;
  v_new_current INT;
BEGIN
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_sub FROM form_submissions
   WHERE id = p_id AND deleted_at IS NULL;  -- ★ soft-delete filter
  IF v_sub.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_sub.status <> '申請中' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  SELECT * INTO v_template FROM form_templates WHERE id = v_sub.template_id;
  v_chain_id := v_template.approval_chain_id;

  IF v_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      UPDATE form_submissions
         SET status = '已核准', approver_id = p_approver_id, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved_no_chain');
    ELSE
      UPDATE form_submissions
         SET status = '已駁回',
             reject_reason = btrim(p_reason),
             reject_attachments = COALESCE(p_reject_attachments, '[]'::jsonb),
             approver_id = p_approver_id, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected_no_chain');
    END IF;
  END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = COALESCE(v_sub.current_step, 0);
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
  END IF;

  IF NOT public._employee_matches_chain_step(p_approver_id, v_step.id, v_sub.applicant_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  IF EXISTS (
    SELECT 1 FROM approval_extra_steps
     WHERE source_table = 'form_submissions'
       AND source_id = p_id
       AND insert_before_step = COALESCE(v_sub.current_step, 0)
       AND status = 'pending'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'PENDING_EXTRA_SIGNER',
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核');
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_chain_id;

  IF p_action = 'reject' THEN
    UPDATE form_submissions
       SET status = '已駁回',
           reject_reason = btrim(p_reason),
           reject_attachments = COALESCE(p_reject_attachments, '[]'::jsonb),
           approver_id = p_approver_id, approved_at = NOW()
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected',
      'rejected_at_step', v_sub.current_step);
  END IF;

  v_new_current := COALESCE(v_sub.current_step, 0) + 1;
  v_is_last     := (v_new_current >= v_total_steps);

  IF v_is_last THEN
    UPDATE form_submissions
       SET status = '已核准', approver_id = p_approver_id, approved_at = NOW(),
           current_step = v_total_steps - 1
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved', 'is_last_step', true);
  ELSE
    UPDATE form_submissions SET current_step = v_new_current WHERE id = p_id;
    SELECT * INTO v_next_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = v_new_current;
    RETURN json_build_object(
      'ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', v_new_current, 'is_last_step', false,
      'next_step_label', v_next_step.label
    );
  END IF;
END
$$;


COMMENT ON FUNCTION public._list_my_signed_approvals IS
  '已簽過列表 helper — chain_signed CTE 加 CASE deleted_at filter 排除已軟刪 row';
COMMENT ON FUNCTION public.liff_get_expense_request_chain_status IS
  '費用申請 chain 進度 (LIFF) — expense_requests.deleted_at IS NULL';
COMMENT ON FUNCTION public.liff_get_expense_settle_chain_status IS
  '費用核銷 chain 進度 (LIFF) — expense_requests.deleted_at IS NULL';
COMMENT ON FUNCTION public.form_submission_chain_approve IS
  '自訂表單簽核 — form_submissions.deleted_at IS NULL';
