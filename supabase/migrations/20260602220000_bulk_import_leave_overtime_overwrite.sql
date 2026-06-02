-- 為 bulk_import_leave / bulk_import_overtime 加上 p_overwrite 參數
-- overwrite=true 時會 UPDATE 已存在的紀錄（hours/unit/days 等），方便重新匯入修正

CREATE OR REPLACE FUNCTION public.bulk_import_leave(
  p_records  jsonb,
  p_overwrite boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_skipped  int := 0;
  v_rec      jsonb;
  v_emp_id   int;
  v_exist_id bigint;
BEGIN
  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    v_emp_id := (v_rec->>'employee_id')::int;

    SELECT id INTO v_exist_id
      FROM public.leave_requests
     WHERE employee_id = v_emp_id
       AND type        = v_rec->>'type'
       AND start_date  = (v_rec->>'start_date')::date
       AND end_date    = (v_rec->>'end_date')::date
     LIMIT 1;

    IF v_exist_id IS NOT NULL THEN
      IF p_overwrite THEN
        UPDATE public.leave_requests SET
          days     = NULLIF(v_rec->>'days','')::numeric,
          unit     = COALESCE(NULLIF(v_rec->>'unit',''), 'day'),
          hours    = NULLIF(v_rec->>'hours','')::numeric,
          reason   = COALESCE(v_rec->>'reason', ''),
          status   = COALESCE(NULLIF(v_rec->>'status',''), '已核准'),
          approver = COALESCE(NULLIF(v_rec->>'approver',''), '匯入')
        WHERE id = v_exist_id;
        v_inserted := v_inserted + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO public.leave_requests
      (employee_id, employee, organization_id, type,
       start_date, end_date, days, unit, hours, reason, status, approver)
    VALUES (
      v_emp_id,
      v_rec->>'employee',
      NULLIF(v_rec->>'organization_id','')::int,
      v_rec->>'type',
      (v_rec->>'start_date')::date,
      (v_rec->>'end_date')::date,
      NULLIF(v_rec->>'days','')::numeric,
      COALESCE(NULLIF(v_rec->>'unit',''), 'day'),
      NULLIF(v_rec->>'hours','')::numeric,
      COALESCE(v_rec->>'reason', ''),
      COALESCE(NULLIF(v_rec->>'status',''), '已核准'),
      COALESCE(NULLIF(v_rec->>'approver',''), '匯入')
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_import_overtime(
  p_records  jsonb,
  p_overwrite boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_skipped  int := 0;
  v_rec      jsonb;
  v_emp_id   int;
  v_exist_id bigint;
BEGIN
  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    v_emp_id := (v_rec->>'employee_id')::int;

    SELECT id INTO v_exist_id
      FROM public.overtime_requests
     WHERE employee_id = v_emp_id
       AND date        = (v_rec->>'date')::date
     LIMIT 1;

    IF v_exist_id IS NOT NULL THEN
      IF p_overwrite THEN
        UPDATE public.overtime_requests SET
          hours      = NULLIF(v_rec->>'hours','')::numeric,
          category   = NULLIF(v_rec->>'category',''),
          start_time = NULLIF(v_rec->>'start_time','')::time,
          end_time   = NULLIF(v_rec->>'end_time','')::time,
          reason     = COALESCE(v_rec->>'reason', ''),
          status     = COALESCE(NULLIF(v_rec->>'status',''), '已核准'),
          source     = COALESCE(NULLIF(v_rec->>'source',''), 'import')
        WHERE id = v_exist_id;
        v_inserted := v_inserted + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO public.overtime_requests
      (employee_id, employee, organization_id, date, hours,
       category, start_time, end_time, reason, status, source, store)
    VALUES (
      v_emp_id,
      v_rec->>'employee',
      NULLIF(v_rec->>'organization_id','')::int,
      (v_rec->>'date')::date,
      NULLIF(v_rec->>'hours','')::numeric,
      NULLIF(v_rec->>'category',''),
      NULLIF(v_rec->>'start_time','')::time,
      NULLIF(v_rec->>'end_time','')::time,
      COALESCE(v_rec->>'reason', ''),
      COALESCE(NULLIF(v_rec->>'status',''), '已核准'),
      COALESCE(NULLIF(v_rec->>'source',''), 'import'),
      NULLIF(v_rec->>'store','')
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_import_leave(jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_overtime(jsonb, boolean) TO authenticated;
