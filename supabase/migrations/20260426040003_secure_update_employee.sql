-- ============================================================
-- secure_update_employee: SECURITY DEFINER 繞過 RLS 直接更新員工
-- 內部判：super_admin / admin / manager 才放行
-- 用途：解 OrgModule 編輯員工 403 問題（RLS 不知為何擋了）
-- ============================================================

CREATE OR REPLACE FUNCTION public.secure_update_employee(
  p_id   INT,
  p_data JSONB
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_id   INT;
  v_target      employees;
  v_updated     employees;
BEGIN
  v_caller_role := public.current_employee_role();
  v_caller_id   := public.current_employee_id();

  -- 權限：super_admin / admin / manager OR 自己改自己
  IF NOT (v_caller_role IN ('super_admin', 'admin', 'manager') OR v_caller_id = p_id) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN',
      'caller_role', v_caller_role, 'caller_id', v_caller_id);
  END IF;

  SELECT * INTO v_target FROM employees WHERE id = p_id;
  IF v_target.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  -- 執行 update，只更新 p_data 裡有的欄位（白名單，避免亂改 id/role_id 等敏感欄）
  UPDATE employees SET
    name             = COALESCE(p_data->>'name',             name),
    name_en          = COALESCE(p_data->>'name_en',          name_en),
    email            = COALESCE(p_data->>'email',            email),
    phone            = COALESCE(p_data->>'phone',            phone),
    dept             = COALESCE(p_data->>'dept',             dept),
    department_id    = COALESCE(NULLIF(p_data->>'department_id','')::INT, department_id),
    position         = COALESCE(p_data->>'position',         position),
    store            = COALESCE(p_data->>'store',            store),
    store_id         = COALESCE(NULLIF(p_data->>'store_id','')::INT, store_id),
    status           = COALESCE(p_data->>'status',           status),
    join_date        = COALESCE(NULLIF(p_data->>'join_date','')::DATE, join_date),
    avatar           = COALESCE(p_data->>'avatar',           avatar),
    avatar_url       = COALESCE(p_data->>'avatar_url',       avatar_url),
    supervisor_id    = COALESCE(NULLIF(p_data->>'supervisor_id','')::INT, supervisor_id),
    employee_number  = COALESCE(p_data->>'employee_number',  employee_number),
    is_manager       = COALESCE((p_data->>'is_manager')::BOOLEAN, is_manager),
    -- role / role_id 只有 admin+ 能改
    role     = CASE WHEN v_caller_role IN ('admin','super_admin')
                    THEN COALESCE(p_data->>'role', role) ELSE role END,
    role_id  = CASE WHEN v_caller_role IN ('admin','super_admin')
                    THEN COALESCE(NULLIF(p_data->>'role_id','')::INT, role_id) ELSE role_id END
  WHERE id = p_id
  RETURNING * INTO v_updated;

  RETURN json_build_object('ok', true, 'employee', row_to_json(v_updated));
END $$;

GRANT EXECUTE ON FUNCTION public.secure_update_employee(INT, JSONB) TO authenticated, anon;
NOTIFY pgrst, 'reload schema';
