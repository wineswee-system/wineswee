-- ════════════════════════════════════════════════════════════
-- LIFF 簽核中心 expense_request 進度時間軸 RPC
--
-- 回傳指定 expense_request 的 chain steps 列表 + 每關狀態：
--   - completed: 已通過 (step_order < current_step)
--   - current:   待簽 (step_order == current_step) 且 status = '申請中'
--   - rejected:  被駁回 (status='已退回' AND step_order == current_step)
--   - pending:   尚未到 (step_order > current_step)
--
-- 並解析每關的 approver 顯示名（依 target_type）。
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_get_expense_request_chain_status(
  p_id INT
)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_record    RECORD;
  v_result    JSON;
BEGIN
  SELECT id, approval_chain_id, current_step, status, reject_reason, employee, organization_id
    INTO v_record
    FROM expense_requests
   WHERE id = p_id;

  IF v_record.id IS NULL OR v_record.approval_chain_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT json_agg(
    json_build_object(
      'step_order', s.step_order,
      'label',      COALESCE(s.label, s.role_name, '第' || (s.step_order + 1) || '關'),
      'name',       (
        CASE s.target_type
          WHEN 'fixed_emp' THEN
            (SELECT name FROM employees WHERE id = s.target_emp_id LIMIT 1)
          WHEN 'fixed_dept' THEN
            (SELECT '部門：' || name FROM departments WHERE id = s.target_dept_id LIMIT 1)
          WHEN 'fixed_role' THEN
            (SELECT '角色：' || name FROM roles WHERE id = s.target_role_id LIMIT 1)
          WHEN 'specific_dept_manager' THEN
            (SELECT e.name FROM employees e
              JOIN departments d ON d.manager_id = e.id
              WHERE d.id = s.target_dept_id LIMIT 1)
          WHEN 'specific_store_manager' THEN
            (SELECT e.name FROM employees e
              JOIN stores st ON st.manager_id = e.id
              WHERE st.id = s.target_store_id LIMIT 1)
          ELSE NULL
        END
      ),
      'status', (
        CASE
          WHEN v_record.status = '已退回' AND s.step_order = v_record.current_step THEN 'rejected'
          WHEN v_record.status = '已核銷' OR v_record.status = '已核准' THEN 'completed'
          WHEN s.step_order < v_record.current_step THEN 'completed'
          WHEN s.step_order = v_record.current_step AND v_record.status = '申請中' THEN 'current'
          ELSE 'pending'
        END
      ),
      'reject_reason', (
        CASE WHEN v_record.status = '已退回' AND s.step_order = v_record.current_step
             THEN v_record.reject_reason
             ELSE NULL END
      )
    ) ORDER BY s.step_order
  )
  INTO v_result
  FROM approval_chain_steps s
  WHERE s.chain_id = v_record.approval_chain_id;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.liff_get_expense_request_chain_status(INT)
  TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
