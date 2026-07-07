-- bulk_import_schedule：排班批次匯入 RPC（比照 bulk_import_attendance）
-- 2026-07-07
-- 按 (employee_id, date) 去重；overwrite=true 可重跑修正。
-- 上班日填 shift + actual_start/end（time）；分段班另填 shift_2/actual_start_2/actual_end_2；
-- 休假類（休息/例假/國定假）填 absence_type、時間留空。status 一律 draft（不觸發發布鎖）。

CREATE OR REPLACE FUNCTION public.bulk_import_schedule(
  p_records  jsonb,
  p_overwrite boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_skipped  int := 0;
  v_rec      jsonb;
  v_emp_id   int;
  v_date     date;
  v_exist_id bigint;
BEGIN
  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_records) LOOP
    v_emp_id := (v_rec->>'employee_id')::int;
    v_date   := (v_rec->>'date')::date;

    SELECT id INTO v_exist_id FROM public.schedules
     WHERE employee_id = v_emp_id AND date = v_date LIMIT 1;

    IF v_exist_id IS NOT NULL THEN
      IF p_overwrite THEN
        UPDATE public.schedules SET
          shift          = v_rec->>'shift',
          source_store   = NULLIF(v_rec->>'source_store',''),
          month_group    = NULLIF(v_rec->>'month_group',''),
          actual_start   = NULLIF(v_rec->>'actual_start','')::time,
          actual_end     = NULLIF(v_rec->>'actual_end','')::time,
          actual_hours   = NULLIF(v_rec->>'actual_hours','')::numeric,
          shift_2        = NULLIF(v_rec->>'shift_2',''),
          actual_start_2 = NULLIF(v_rec->>'actual_start_2','')::time,
          actual_end_2   = NULLIF(v_rec->>'actual_end_2','')::time,
          actual_hours_2 = NULLIF(v_rec->>'actual_hours_2','')::numeric,
          absence_type   = NULLIF(v_rec->>'absence_type',''),
          status         = COALESCE(NULLIF(v_rec->>'status',''), 'draft')
        WHERE id = v_exist_id;
        v_inserted := v_inserted + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO public.schedules
      (employee_id, employee, organization_id, date, shift,
       source_store, month_group,
       actual_start, actual_end, actual_hours,
       shift_2, actual_start_2, actual_end_2, actual_hours_2,
       absence_type, status)
    VALUES (
      v_emp_id,
      v_rec->>'employee',
      NULLIF(v_rec->>'organization_id','')::int,
      v_date,
      v_rec->>'shift',
      NULLIF(v_rec->>'source_store',''),
      NULLIF(v_rec->>'month_group',''),
      NULLIF(v_rec->>'actual_start','')::time,
      NULLIF(v_rec->>'actual_end','')::time,
      NULLIF(v_rec->>'actual_hours','')::numeric,
      NULLIF(v_rec->>'shift_2',''),
      NULLIF(v_rec->>'actual_start_2','')::time,
      NULLIF(v_rec->>'actual_end_2','')::time,
      NULLIF(v_rec->>'actual_hours_2','')::numeric,
      NULLIF(v_rec->>'absence_type',''),
      COALESCE(NULLIF(v_rec->>'status',''), 'draft')
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_import_schedule(jsonb, boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
