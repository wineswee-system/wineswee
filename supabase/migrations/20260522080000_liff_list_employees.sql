-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 通用員工列表 RPC — 繞過 anon RLS
-- ────────────────────────────────────────────────────────────────────────────
-- 慘案紀錄：feedback_liff_anon_rls — LIFF 用 anon key 直查 employees 被 RLS
--          silent skip，前端拿到空陣列以為沒資料。
-- 解法：SECURITY DEFINER RPC，依 line_user_id 解 emp 後回傳同 org 在職員工。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_list_employees(
  p_line_user_id text
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp    employees;
  v_list json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 對齊系統慣例：dept/store 優先用 denormalized text，fallback join name
  SELECT json_agg(json_build_object(
    'id', e.id,
    'name', e.name,
    'name_en', e.name_en,
    'position', e.position,
    'dept', COALESCE(e.dept, d.name),
    'store', COALESCE(e.store, s.name),
    'department_id', e.department_id,
    'store_id', e.store_id
  ) ORDER BY e.name) INTO v_list
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN stores s ON s.id = e.store_id
  WHERE e.status = '在職'
    AND e.organization_id = emp.organization_id;

  RETURN json_build_object('ok', true, 'list', COALESCE(v_list, '[]'::json));
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_employees(text) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
