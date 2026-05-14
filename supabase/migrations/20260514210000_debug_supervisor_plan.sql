-- 診斷：列出「目前 supervisor_id=NULL 但實際是部門主管」的人 + 將被改成誰
-- 純讀取，不改資料
BEGIN;

CREATE OR REPLACE FUNCTION public._debug_supervisor_backfill_plan()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ceo_id INT;
  v_ceo_name TEXT;
  v_result json;
BEGIN
  -- 找總經理（總經理室部門主管）
  SELECT d.manager_id, e.name
    INTO v_ceo_id, v_ceo_name
    FROM departments d
    LEFT JOIN employees e ON e.id = d.manager_id
   WHERE d.name = '總經理室'
   LIMIT 1;

  SELECT json_build_object(
    'ceo', json_build_object(
      'id', v_ceo_id,
      'name', v_ceo_name,
      'found', v_ceo_id IS NOT NULL
    ),
    'will_update', (
      SELECT json_agg(json_build_object(
        'employee_id', e.id,
        'employee_name', e.name,
        'position', e.position,
        'department', d.name,
        'is_dept_manager_of', mgr_dept.name,
        'current_supervisor_id', e.supervisor_id,
        'proposed_supervisor_id', CASE
          WHEN mgr_dept.name = '總經理室' THEN NULL
          ELSE v_ceo_id
        END,
        'proposed_supervisor_name', CASE
          WHEN mgr_dept.name = '總經理室' THEN NULL
          ELSE v_ceo_name
        END,
        'reason', CASE
          WHEN mgr_dept.name = '總經理室' THEN '總經理室主管，留 NULL'
          ELSE '部門主管 → 改指向總經理'
        END
      ) ORDER BY e.id)
        FROM employees e
        LEFT JOIN departments d ON d.id = e.department_id
        JOIN departments mgr_dept ON mgr_dept.manager_id = e.id
       WHERE e.status = '在職'
         AND e.supervisor_id IS NULL
    ),
    'already_correct', (
      SELECT json_agg(json_build_object(
        'employee_id', e.id,
        'employee_name', e.name,
        'current_supervisor_id', e.supervisor_id,
        'reason', '已有 supervisor_id，不動'
      ) ORDER BY e.id)
        FROM employees e
        JOIN departments mgr_dept ON mgr_dept.manager_id = e.id
       WHERE e.status = '在職'
         AND e.supervisor_id IS NOT NULL
    )
  ) INTO v_result;
  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public._debug_supervisor_backfill_plan() TO authenticated, anon, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
