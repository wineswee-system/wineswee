-- 修:import_schedules 只寫 employee(名字)、沒寫 employee_id → 排班表 RLS(schedules_v_sel)
-- 靠 employee_id 判可見性,null 永遠不成立 → 店長/員工看不到匯入的班表(只有 admin/super_admin 看得到)。
-- 讓 RPC 由 name+org 解析 employee_id(優先在職),INSERT/UPDATE 都補上。

CREATE OR REPLACE FUNCTION public.import_schedules(p_rows jsonb, p_org integer, p_actor_id integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller     employees;
  v_row        jsonb;
  v_existing   int;
  v_success    int := 0;
  v_fail       int := 0;
  v_errors     jsonb := '[]'::jsonb;
  v_name       text;
  v_date       date;
  v_emp_id     int;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL AND p_actor_id IS NOT NULL THEN
    SELECT * INTO v_caller FROM employees WHERE id = p_actor_id;
  END IF;
  IF v_caller.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CALLER_NOT_FOUND');
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ROWS');
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_name := v_row->>'name';
      v_date := (v_row->>'date')::date;

      -- ★ 由 name+org 解析 employee_id(優先在職)→ 排班表 RLS 靠此判可見性
      v_emp_id := (v_row->>'employee_id')::int;  -- 前端若已帶就用
      IF v_emp_id IS NULL THEN
        SELECT id INTO v_emp_id
          FROM employees
         WHERE name = v_name
           AND (organization_id = p_org OR (organization_id IS NULL AND p_org IS NULL))
         ORDER BY (status = '在職') DESC, id
         LIMIT 1;
      END IF;

      SELECT id INTO v_existing
        FROM schedules
       WHERE employee = v_name AND date = v_date
         AND (organization_id = p_org OR (organization_id IS NULL AND p_org IS NULL))
       LIMIT 1;

      IF v_existing IS NOT NULL THEN
        UPDATE schedules SET
          shift        = v_row->>'shift',
          actual_start = NULLIF(v_row->>'actual_start','')::time,
          actual_end   = NULLIF(v_row->>'actual_end','')::time,
          source_store = NULLIF(v_row->>'source_store',''),
          organization_id = p_org,
          employee_id  = COALESCE(v_emp_id, employee_id)
        WHERE id = v_existing;
      ELSE
        INSERT INTO schedules (employee, employee_id, date, shift, actual_start, actual_end, source_store, organization_id)
        VALUES (
          v_name, v_emp_id, v_date, v_row->>'shift',
          NULLIF(v_row->>'actual_start','')::time, NULLIF(v_row->>'actual_end','')::time,
          NULLIF(v_row->>'source_store',''), p_org
        );
      END IF;
      v_success := v_success + 1;

    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_object(
        'row', v_row->>'rowNum', 'name', v_row->>'name',
        'date', v_row->>'date', 'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'success', v_success, 'fail', v_fail, 'errors', v_errors);
END $function$;

-- 回填:過去匯入造成 employee_id 為 null 的班表(僅在該 org 內姓名唯一時才補,避免同名誤掛)
UPDATE public.schedules s
   SET employee_id = e.id
  FROM public.employees e
 WHERE s.employee_id IS NULL
   AND e.name = s.employee
   AND e.organization_id = s.organization_id
   AND (SELECT count(*) FROM public.employees e2
         WHERE e2.name = s.employee AND e2.organization_id = s.organization_id) = 1;
