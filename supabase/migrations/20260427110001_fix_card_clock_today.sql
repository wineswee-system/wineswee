-- Fix liff_card_clock_today: clock_out_location 欄位不存在（只有 clock_out_lat/lng/ip）

CREATE OR REPLACE FUNCTION public.liff_card_clock_today(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_today    date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date;
  att        record;
  sched      record;
  store_name text;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT clock_in, clock_out, clock_in_location, hours, status
    INTO att
    FROM public.attendance_records
   WHERE date = v_today
     AND (employee_id = emp.id OR employee = emp.name)
   ORDER BY id DESC LIMIT 1;

  SELECT shift, actual_start, actual_end, absence_type
    INTO sched
    FROM public.schedules
   WHERE employee_id = emp.id AND date = v_today
   LIMIT 1;

  IF emp.store_id IS NOT NULL THEN
    SELECT name INTO store_name FROM public.stores WHERE id = emp.store_id;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'employee_name', emp.name,
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'weekday', CASE EXTRACT(DOW FROM v_today)::int
                 WHEN 0 THEN '日' WHEN 1 THEN '一' WHEN 2 THEN '二'
                 WHEN 3 THEN '三' WHEN 4 THEN '四' WHEN 5 THEN '五'
                 WHEN 6 THEN '六' END,
    'store', store_name,
    'clock_in',          to_char(att.clock_in, 'HH24:MI'),
    'clock_out',         to_char(att.clock_out, 'HH24:MI'),
    'clock_in_location', att.clock_in_location,
    'hours',             att.hours,
    'attendance_status', att.status,
    'shift',             sched.shift,
    'shift_start',       to_char(sched.actual_start, 'HH24:MI'),
    'shift_end',         to_char(sched.actual_end, 'HH24:MI'),
    'absence_type',      sched.absence_type
  );
END $$;
