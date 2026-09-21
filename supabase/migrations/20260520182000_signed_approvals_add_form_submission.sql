-- ════════════════════════════════════════════════════════════════════════════
-- 補 _list_my_signed_approvals 對 form_submission 的 CASE 支援
-- ────────────────────────────────────────────────────────────────────────────
-- 20260519140000 建 RPC 時，form_submissions 還未掛 ash trigger（20260519220001）
-- 所以 applicant_name / current_status / summary 的 CASE 全漏掉 'form_submission'
-- 這裡 REPLACE 成完整版。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._list_my_signed_approvals(
  p_emp_id     INT,
  p_year_month TEXT  -- 'YYYY-MM' or NULL = 全部
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
  all_signed AS (
    SELECT * FROM chain_signed
    UNION ALL
    SELECT * FROM extra_signed
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
      END
    )
  ) ORDER BY signed_at DESC)
  INTO result FROM all_signed;

  RETURN COALESCE(result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public._list_my_signed_approvals(INT, TEXT) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
