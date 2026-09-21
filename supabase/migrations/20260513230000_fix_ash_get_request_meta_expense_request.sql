-- 修 _ash_get_request_meta 對 expense_request 走 COALESCE(approver, approved_by) 會炸
-- 2026-05-13
--
-- expense_requests 表只有 approved_by 沒 approver 欄位。
-- 原本 ELSE 分支用 COALESCE(approver, approved_by) → 動態 SQL 在 expense_requests 上
--   42703 column "approver" does not exist
--
-- 修：把 expense_request 拉出獨立分支，直接用 approved_by

BEGIN;

CREATE OR REPLACE FUNCTION public._ash_get_request_meta(
  p_request_type TEXT,
  p_request_id   INT
) RETURNS TABLE (
  chain_id        INT,
  current_step    INT,
  status          TEXT,
  organization_id INT,
  applicant_id    INT,
  applicant_name  TEXT,
  approver_name   TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table TEXT;
BEGIN
  v_table := CASE p_request_type
    WHEN 'leave'           THEN 'leave_requests'
    WHEN 'overtime'        THEN 'overtime_requests'
    WHEN 'trip'            THEN 'business_trips'
    WHEN 'correction'      THEN 'clock_corrections'
    WHEN 'expense'         THEN 'expenses'
    WHEN 'expense_request' THEN 'expense_requests'
    WHEN 'resignation'     THEN 'resignation_requests'
    WHEN 'loa'             THEN 'leave_of_absence_requests'
    WHEN 'transfer'        THEN 'personnel_transfer_requests'
  END;
  IF v_table IS NULL THEN RETURN; END IF;

  IF p_request_type IN ('leave','overtime') THEN
    -- 有 employee_id + employee + approver
    RETURN QUERY EXECUTE format(
      'SELECT approval_chain_id, current_step, status, organization_id, employee_id, employee, approver FROM %I WHERE id=$1',
      v_table
    ) USING p_request_id;
  ELSIF p_request_type = 'expense_request' THEN
    -- 沒 approver，只有 approved_by
    RETURN QUERY EXECUTE format(
      'SELECT approval_chain_id, current_step, status, organization_id, employee_id, employee, approved_by FROM %I WHERE id=$1',
      v_table
    ) USING p_request_id;
  ELSIF p_request_type IN ('resignation','loa','transfer') THEN
    -- B 類用 employee_id 跟 approver_id（沒 employee text、沒 approver text）
    RETURN QUERY EXECUTE format(
      'SELECT approval_chain_id, current_step, status, organization_id, employee_id,
              (SELECT name FROM employees WHERE id = r.employee_id) AS applicant_name,
              (SELECT name FROM employees WHERE id = r.approver_id) AS approver_name
         FROM %I r WHERE id=$1',
      v_table
    ) USING p_request_id;
  ELSE
    -- trip / correction / expense：有 employee text + approver text（沒 approved_by）
    RETURN QUERY EXECUTE format(
      'SELECT approval_chain_id, current_step, status, organization_id, NULL::INT, employee, approver FROM %I WHERE id=$1',
      v_table
    ) USING p_request_id;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
