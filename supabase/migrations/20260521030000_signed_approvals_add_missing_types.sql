-- ════════════════════════════════════════════════════════════════════════════
-- 補 _list_my_signed_approvals 缺少的四類簽核：
--   off_request / shift_swap（主管 + 對方同意）/ task_confirmation / expense_settle
-- ────────────────────────────────────────────────────────────────────────────
-- 不掛新 ash trigger；直接在 RPC 加 UNION ALL CTE 從原始表查。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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

  WITH chain_signed AS (
    SELECT
      ash.request_type::text  AS source_type,
      ash.request_id          AS source_id,
      ash.action              AS my_action,
      ash.exited_at           AS signed_at,
      ash.step_order          AS step_order,
      ash.step_label          AS step_label,
      false                   AS is_extra
    FROM approval_step_history ash
    WHERE ash.approver_id = p_emp_id
      AND ash.action IN ('approved', 'rejected')
      AND ash.exited_at IS NOT NULL
      AND (p_year_month IS NULL OR (ash.exited_at >= v_start AND ash.exited_at < v_end))
  ),
  extra_signed AS (
    SELECT
      CASE es.source_table
        WHEN 'leave_requests'                THEN 'leave'
        WHEN 'overtime_requests'             THEN 'overtime'
        WHEN 'business_trips'                THEN 'trip'
        WHEN 'clock_corrections'             THEN 'correction'
        WHEN 'expenses'                      THEN 'expense'
        WHEN 'expense_requests'              THEN 'expense_request'
        WHEN 'resignation_requests'          THEN 'resignation'
        WHEN 'leave_of_absence_requests'     THEN 'loa'
        WHEN 'personnel_transfer_requests'   THEN 'transfer'
        WHEN 'headcount_requests'            THEN 'headcount'
        WHEN 'form_submissions'              THEN 'form_submission'
        ELSE es.source_table
      END                     AS source_type,
      es.source_id            AS source_id,
      es.status               AS my_action,
      es.approved_at          AS signed_at,
      NULL::int               AS step_order,
      '加簽'                  AS step_label,
      true                    AS is_extra
    FROM approval_extra_steps es
    WHERE es.assignee_id = p_emp_id
      AND es.status IN ('approved', 'rejected')
      AND es.approved_at IS NOT NULL
      AND (p_year_month IS NULL OR (es.approved_at >= v_start AND es.approved_at < v_end))
  ),
  -- ── 希望休（off_requests 有 approver_id INT）
  off_signed AS (
    SELECT
      'off_request'           AS source_type,
      ofr.id                  AS source_id,
      CASE ofr.status WHEN '已核准' THEN 'approved' ELSE 'rejected' END AS my_action,
      ofr.approved_at         AS signed_at,
      NULL::int               AS step_order,
      '希望休核准'            AS step_label,
      false                   AS is_extra
    FROM off_requests ofr
    WHERE ofr.approver_id = p_emp_id
      AND ofr.status IN ('已核准', '已駁回')
      AND ofr.approved_at IS NOT NULL
      AND (p_year_month IS NULL OR (ofr.approved_at >= v_start AND ofr.approved_at < v_end))
  ),
  -- ── 換班 — 主管核准（shift_swaps 有 approver_id INT）
  shift_mgr_signed AS (
    SELECT
      'shift_swap'            AS source_type,
      ss.id                   AS source_id,
      CASE ss.status WHEN '已核准' THEN 'approved' ELSE 'rejected' END AS my_action,
      ss.approved_at          AS signed_at,
      NULL::int               AS step_order,
      '主管核准'              AS step_label,
      false                   AS is_extra
    FROM shift_swaps ss
    WHERE ss.approver_id = p_emp_id
      AND ss.status IN ('已核准', '已拒絕')
      AND ss.approved_at IS NOT NULL
      AND (p_year_month IS NULL OR (ss.approved_at >= v_start AND ss.approved_at < v_end))
  ),
  -- ── 換班 — 對方同意（target_id = me，peer_response 已填）
  shift_peer_signed AS (
    SELECT
      'shift_swap'            AS source_type,
      ss.id                   AS source_id,
      CASE ss.peer_response WHEN '同意' THEN 'approved' ELSE 'rejected' END AS my_action,
      ss.peer_responded_at    AS signed_at,
      NULL::int               AS step_order,
      '對方同意'              AS step_label,
      false                   AS is_extra
    FROM shift_swaps ss
    WHERE ss.target_id = p_emp_id
      AND ss.peer_response IS NOT NULL
      AND ss.peer_responded_at IS NOT NULL
      AND (p_year_month IS NULL OR (ss.peer_responded_at >= v_start AND ss.peer_responded_at < v_end))
  ),
  -- ── 任務確認（task_confirmations 只有 approver TEXT，需 name→id join）
  task_signed AS (
    SELECT
      'task_confirmation'     AS source_type,
      tc.id                   AS source_id,
      tc.status               AS my_action,    -- 'approved' / 'rejected'
      tc.responded_at         AS signed_at,
      tc.step_order           AS step_order,
      '任務確認'              AS step_label,
      false                   AS is_extra
    FROM task_confirmations tc
    JOIN employees e ON e.name = tc.approver
    WHERE e.id = p_emp_id
      AND tc.status IN ('approved', 'rejected')
      AND tc.responded_at IS NOT NULL
      AND (p_year_month IS NULL OR (tc.responded_at >= v_start AND tc.responded_at < v_end))
  ),
  -- ── 費用核銷（expense_requests.settled_by TEXT 是最終核銷人；中間關無記錄）
  settle_signed AS (
    SELECT
      'expense_settle'        AS source_type,
      er.id                   AS source_id,
      'approved'              AS my_action,
      er.settled_at           AS signed_at,
      NULL::int               AS step_order,
      '費用核銷'              AS step_label,
      false                   AS is_extra
    FROM expense_requests er
    JOIN employees e ON e.name = er.settled_by
    WHERE e.id = p_emp_id
      AND er.status = '已核銷'
      AND er.settled_at IS NOT NULL
      AND (p_year_month IS NULL OR (er.settled_at >= v_start AND er.settled_at < v_end))
  ),
  all_signed AS (
    SELECT * FROM chain_signed
    UNION ALL SELECT * FROM extra_signed
    UNION ALL SELECT * FROM off_signed
    UNION ALL SELECT * FROM shift_mgr_signed
    UNION ALL SELECT * FROM shift_peer_signed
    UNION ALL SELECT * FROM task_signed
    UNION ALL SELECT * FROM settle_signed
  )
  SELECT json_agg(json_build_object(
    'source_type',   source_type,
    'source_id',     source_id,
    'my_action',     my_action,
    'signed_at',     signed_at,
    'step_order',    step_order,
    'step_label',    step_label,
    'is_extra',      is_extra,
    'applicant_name', (
      CASE source_type
        WHEN 'leave'            THEN (SELECT employee FROM leave_requests        WHERE id = source_id)
        WHEN 'overtime'         THEN (SELECT employee FROM overtime_requests     WHERE id = source_id)
        WHEN 'trip'             THEN (SELECT employee FROM business_trips        WHERE id = source_id)
        WHEN 'correction'       THEN (SELECT employee FROM clock_corrections     WHERE id = source_id)
        WHEN 'expense'          THEN (SELECT employee FROM expenses              WHERE id = source_id)
        WHEN 'expense_request'  THEN (SELECT employee FROM expense_requests      WHERE id = source_id)
        WHEN 'resignation'      THEN (SELECT e.name FROM resignation_requests r        LEFT JOIN employees e ON e.id = r.employee_id WHERE r.id = source_id)
        WHEN 'loa'              THEN (SELECT e.name FROM leave_of_absence_requests r   LEFT JOIN employees e ON e.id = r.employee_id WHERE r.id = source_id)
        WHEN 'transfer'         THEN (SELECT e.name FROM personnel_transfer_requests r LEFT JOIN employees e ON e.id = r.employee_id WHERE r.id = source_id)
        WHEN 'headcount'        THEN (SELECT e.name FROM headcount_requests r          LEFT JOIN employees e ON e.id = r.employee_id WHERE r.id = source_id)
        WHEN 'form_submission'  THEN (SELECT e.name FROM form_submissions fs           LEFT JOIN employees e ON e.id = fs.applicant_id WHERE fs.id = source_id)
        WHEN 'off_request'      THEN (SELECT employee FROM off_requests          WHERE id = source_id)
        WHEN 'shift_swap'       THEN (SELECT requester FROM shift_swaps          WHERE id = source_id)
        WHEN 'task_confirmation'THEN (SELECT t.title FROM task_confirmations tc JOIN tasks t ON t.id = tc.task_id WHERE tc.id = source_id)
        WHEN 'expense_settle'   THEN (SELECT employee FROM expense_requests      WHERE id = source_id)
      END
    ),
    'current_status', (
      CASE source_type
        WHEN 'leave'            THEN (SELECT status FROM leave_requests               WHERE id = source_id)
        WHEN 'overtime'         THEN (SELECT status FROM overtime_requests            WHERE id = source_id)
        WHEN 'trip'             THEN (SELECT status FROM business_trips               WHERE id = source_id)
        WHEN 'correction'       THEN (SELECT status FROM clock_corrections            WHERE id = source_id)
        WHEN 'expense'          THEN (SELECT status FROM expenses                     WHERE id = source_id)
        WHEN 'expense_request'  THEN (SELECT status FROM expense_requests             WHERE id = source_id)
        WHEN 'resignation'      THEN (SELECT status FROM resignation_requests         WHERE id = source_id)
        WHEN 'loa'              THEN (SELECT status FROM leave_of_absence_requests    WHERE id = source_id)
        WHEN 'transfer'         THEN (SELECT status FROM personnel_transfer_requests  WHERE id = source_id)
        WHEN 'headcount'        THEN (SELECT status FROM headcount_requests           WHERE id = source_id)
        WHEN 'form_submission'  THEN (SELECT status FROM form_submissions             WHERE id = source_id)
        WHEN 'off_request'      THEN (SELECT status FROM off_requests                 WHERE id = source_id)
        WHEN 'shift_swap'       THEN (SELECT status FROM shift_swaps                  WHERE id = source_id)
        WHEN 'task_confirmation'THEN (SELECT tc.status FROM task_confirmations tc     WHERE tc.id = source_id)
        WHEN 'expense_settle'   THEN (SELECT status FROM expense_requests             WHERE id = source_id)
      END
    ),
    'summary', (
      CASE source_type
        WHEN 'leave'            THEN (SELECT type || ' · ' || start_date || ' ~ ' || COALESCE(end_date, start_date)::text FROM leave_requests WHERE id = source_id)
        WHEN 'overtime'         THEN (SELECT '加班 ' || date || ' (' || COALESCE(hours, 0)::text || 'h)' FROM overtime_requests WHERE id = source_id)
        WHEN 'trip'             THEN (SELECT COALESCE(destination, '出差') || ' · ' || start_date || ' ~ ' || COALESCE(end_date, start_date)::text FROM business_trips WHERE id = source_id)
        WHEN 'correction'       THEN (SELECT COALESCE(type, '補打卡') || ' · ' || date FROM clock_corrections WHERE id = source_id)
        WHEN 'expense'          THEN (SELECT title || ' · NT$ ' || COALESCE(amount, 0)::text FROM expenses WHERE id = source_id)
        WHEN 'expense_request'  THEN (SELECT title || ' · NT$ ' || COALESCE(estimated_amount, 0)::text FROM expense_requests WHERE id = source_id)
        WHEN 'resignation'      THEN (SELECT '離職申請 · 預計 ' || COALESCE(planned_resign_date::text, '—') FROM resignation_requests WHERE id = source_id)
        WHEN 'loa'              THEN (SELECT '留停 · ' || COALESCE(reason_type, '—') FROM leave_of_absence_requests WHERE id = source_id)
        WHEN 'transfer'         THEN (SELECT COALESCE(transfer_type, '異動') || ' · 生效 ' || COALESCE(effective_date::text, '—') FROM personnel_transfer_requests WHERE id = source_id)
        WHEN 'headcount'        THEN (SELECT job_title || ' × ' || headcount::text || ' 人' FROM headcount_requests WHERE id = source_id)
        WHEN 'form_submission'  THEN (SELECT t.name FROM form_submissions fs LEFT JOIN form_templates t ON t.id = fs.template_id WHERE fs.id = source_id)
        WHEN 'off_request'      THEN (SELECT employee || ' · ' || date::text FROM off_requests WHERE id = source_id)
        WHEN 'shift_swap'       THEN (SELECT requester || ' · ' || COALESCE(swap_date::text, '#' || source_id::text) FROM shift_swaps WHERE id = source_id)
        WHEN 'task_confirmation'THEN (SELECT t.title FROM task_confirmations tc JOIN tasks t ON t.id = tc.task_id WHERE tc.id = source_id)
        WHEN 'expense_settle'   THEN (SELECT '核銷 ' || title || ' · NT$ ' || COALESCE(actual_amount, estimated_amount, 0)::text FROM expense_requests WHERE id = source_id)
      END
    )
  ) ORDER BY signed_at DESC)
  INTO result FROM all_signed;

  RETURN COALESCE(result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public._list_my_signed_approvals(INT, TEXT) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
