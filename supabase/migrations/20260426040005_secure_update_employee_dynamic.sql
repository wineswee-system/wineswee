-- ============================================================
-- secure_update_employee 終版：dynamic SQL 自動對齊所有欄位
--
-- 設計：
--   1. 從 information_schema 動態取 employees 所有欄位 + 型別
--   2. 過濾掉敏感欄位 (id/created_at/updated_at/auth_user_id)
--   3. 非 admin 額外過濾 role/role_id
--   4. 只更新 p_data 裡有的 key（jsonb_object_keys 交集）
--   5. 各欄位依型別 cast，TEXT 直接拿，其他 NULLIF 空字串再 cast
--   6. EXECUTE format ... USING p_data → bind 防 SQL injection
--   7. 不依賴 RLS，繞過所有 employees policy
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
  v_existing    employees;
  v_set         TEXT;
  v_sql         TEXT;
  v_result      employees;
BEGIN
  v_caller_role := public.current_employee_role();
  v_caller_id   := public.current_employee_id();

  IF NOT ((v_caller_role IN ('super_admin','admin','manager')) OR v_caller_id = p_id) THEN
    RETURN json_build_object(
      'ok', false, 'error', 'FORBIDDEN',
      'caller_role', v_caller_role, 'caller_id', v_caller_id
    );
  END IF;

  SELECT * INTO v_existing FROM employees WHERE id = p_id;
  IF v_existing.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  -- 過濾不可改的欄位
  p_data := p_data - 'id' - 'created_at' - 'updated_at' - 'auth_user_id';
  IF v_caller_role NOT IN ('admin','super_admin') THEN
    p_data := p_data - 'role' - 'role_id';
  END IF;

  -- 動態生成 SET 子句 — employees 表存在的欄位 ∩ p_data 的 key
  -- TEXT 直接拿；其他型別 NULLIF 空字串再 cast
  SELECT string_agg(
    CASE
      WHEN data_type IN ('text','character varying','character') THEN
        format('%I = ($1->>%L)', column_name, column_name)
      WHEN data_type IN ('jsonb','json') THEN
        format('%I = NULLIF($1->>%L, '''')::%s', column_name, column_name, data_type)
      WHEN data_type IN ('boolean') THEN
        format('%I = NULLIF($1->>%L, '''')::boolean', column_name, column_name)
      WHEN data_type IN ('integer','bigint','smallint','numeric','double precision','real') THEN
        format('%I = NULLIF($1->>%L, '''')::%s', column_name, column_name, data_type)
      WHEN data_type IN ('date') THEN
        format('%I = NULLIF($1->>%L, '''')::date', column_name, column_name)
      WHEN data_type LIKE 'timestamp%' THEN
        format('%I = NULLIF($1->>%L, '''')::%s', column_name, column_name, data_type)
      WHEN data_type IN ('time','time without time zone','time with time zone') THEN
        format('%I = NULLIF($1->>%L, '''')::time', column_name, column_name)
      ELSE
        format('%I = ($1->>%L)', column_name, column_name)
    END,
    ', '
  )
  INTO v_set
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'employees'
    AND column_name <> ALL(ARRAY['id','created_at','updated_at','auth_user_id'])
    AND p_data ? column_name;

  IF v_set IS NULL OR v_set = '' THEN
    RETURN json_build_object('ok', true, 'employee', row_to_json(v_existing), 'note', 'no_fields_to_update');
  END IF;

  v_sql := format('UPDATE employees SET %s WHERE id = $2 RETURNING *', v_set);

  EXECUTE v_sql USING p_data, p_id INTO v_result;

  RETURN json_build_object('ok', true, 'employee', row_to_json(v_result));
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'ok', false, 'error', SQLERRM,
    'sqlstate', SQLSTATE,
    'sql', v_sql,
    'caller_role', v_caller_role
  );
END $$;

GRANT EXECUTE ON FUNCTION public.secure_update_employee(INT, JSONB) TO authenticated, anon;
NOTIFY pgrst, 'reload schema';
