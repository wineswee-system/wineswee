-- 修：secure_update_employee 沒處理 ARRAY 型別
--   employees.special_categories / additional_stores 是 TEXT[]
--   原本 cast 成 TEXT → "type text[] but expression is of type text" error
-- 改：data_type = 'ARRAY' 時用 jsonb_array_elements_text 轉 TEXT[]

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
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN',
      'caller_role', v_caller_role, 'caller_id', v_caller_id);
  END IF;

  SELECT * INTO v_existing FROM employees WHERE id = p_id;
  IF v_existing.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  p_data := p_data - 'id' - 'created_at' - 'updated_at' - 'auth_user_id';
  IF v_caller_role NOT IN ('admin','super_admin') THEN
    p_data := p_data - 'role' - 'role_id';
  END IF;

  -- 動態生成 SET 子句，依欄位型別處理
  SELECT string_agg(
    CASE
      -- ARRAY (text[] / int[] etc)：jsonb 陣列 → unnest text → 自動 cast 回元素型別
      WHEN data_type = 'ARRAY' THEN
        format(
          '%I = CASE WHEN jsonb_typeof($1->%L) = ''array'' THEN ARRAY(SELECT jsonb_array_elements_text($1->%L))::%s ELSE NULL END',
          column_name, column_name, column_name, udt_name
        )
      -- TEXT 系：直接拿
      WHEN data_type IN ('text','character varying','character') THEN
        format('%I = ($1->>%L)', column_name, column_name)
      -- JSONB / JSON：直接拿物件
      WHEN data_type IN ('jsonb','json') THEN
        format('%I = NULLIF($1->>%L, '''')::%s', column_name, column_name, data_type)
      -- BOOLEAN
      WHEN data_type = 'boolean' THEN
        format('%I = NULLIF($1->>%L, '''')::boolean', column_name, column_name)
      -- 數字 / 日期 / timestamp / time：NULLIF 空字串再 cast
      WHEN data_type IN ('integer','bigint','smallint','numeric','double precision','real','date') THEN
        format('%I = NULLIF($1->>%L, '''')::%s', column_name, column_name, data_type)
      WHEN data_type LIKE 'timestamp%' THEN
        format('%I = NULLIF($1->>%L, '''')::%s', column_name, column_name, data_type)
      WHEN data_type LIKE 'time%' THEN
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
