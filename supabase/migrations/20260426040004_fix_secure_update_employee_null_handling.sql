-- 修：secure_update_employee 之前用 COALESCE，設 NULL 永遠失敗（被舊值蓋回）
-- 改：CASE WHEN p_data ? 'key' THEN 採用新值（含 NULL/空字串） ELSE 保留舊值

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

  IF NOT (v_caller_role IN ('super_admin', 'admin', 'manager') OR v_caller_id = p_id) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN',
      'caller_role', v_caller_role, 'caller_id', v_caller_id);
  END IF;

  SELECT * INTO v_target FROM employees WHERE id = p_id;
  IF v_target.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  -- 只更新 payload 裡有的 key（支援清空 / 設 NULL / 改值）
  -- pattern: CASE WHEN p_data ? 'key' THEN <new value, may be null> ELSE <existing> END
  UPDATE employees SET
    name             = CASE WHEN p_data ? 'name'             THEN p_data->>'name'             ELSE name             END,
    name_en          = CASE WHEN p_data ? 'name_en'          THEN p_data->>'name_en'          ELSE name_en          END,
    email            = CASE WHEN p_data ? 'email'            THEN p_data->>'email'            ELSE email            END,
    phone            = CASE WHEN p_data ? 'phone'            THEN p_data->>'phone'            ELSE phone            END,
    dept             = CASE WHEN p_data ? 'dept'             THEN p_data->>'dept'             ELSE dept             END,
    department_id    = CASE WHEN p_data ? 'department_id'    THEN NULLIF(p_data->>'department_id','')::INT ELSE department_id END,
    position         = CASE WHEN p_data ? 'position'         THEN p_data->>'position'         ELSE position         END,
    store            = CASE WHEN p_data ? 'store'            THEN p_data->>'store'            ELSE store            END,
    store_id         = CASE WHEN p_data ? 'store_id'         THEN NULLIF(p_data->>'store_id','')::INT ELSE store_id END,
    status           = CASE WHEN p_data ? 'status'           THEN p_data->>'status'           ELSE status           END,
    join_date        = CASE WHEN p_data ? 'join_date'        THEN NULLIF(p_data->>'join_date','')::DATE ELSE join_date END,
    avatar           = CASE WHEN p_data ? 'avatar'           THEN p_data->>'avatar'           ELSE avatar           END,
    avatar_url       = CASE WHEN p_data ? 'avatar_url'       THEN p_data->>'avatar_url'       ELSE avatar_url       END,
    supervisor_id    = CASE WHEN p_data ? 'supervisor_id'    THEN NULLIF(p_data->>'supervisor_id','')::INT ELSE supervisor_id END,
    employee_number  = CASE WHEN p_data ? 'employee_number'  THEN p_data->>'employee_number'  ELSE employee_number  END,
    is_manager       = CASE WHEN p_data ? 'is_manager'       THEN (p_data->>'is_manager')::BOOLEAN ELSE is_manager  END,
    -- role / role_id：admin+ 才可改；非 admin caller 即使送了也忽略
    role     = CASE
                 WHEN v_caller_role IN ('admin','super_admin') AND p_data ? 'role'
                   THEN p_data->>'role'
                 ELSE role
               END,
    role_id  = CASE
                 WHEN v_caller_role IN ('admin','super_admin') AND p_data ? 'role_id'
                   THEN NULLIF(p_data->>'role_id','')::INT
                 ELSE role_id
               END
  WHERE id = p_id
  RETURNING * INTO v_updated;

  RETURN json_build_object('ok', true, 'employee', row_to_json(v_updated));
END $$;

GRANT EXECUTE ON FUNCTION public.secure_update_employee(INT, JSONB) TO authenticated, anon;
NOTIFY pgrst, 'reload schema';
