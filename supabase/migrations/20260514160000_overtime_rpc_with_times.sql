-- liff_insert_overtime_request / liff_update_overtime_request 接受 start_time / end_time
BEGIN;

CREATE OR REPLACE FUNCTION public.liff_insert_overtime_request(p_line_user_id text, p_payload json)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  new_id int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  INSERT INTO public.overtime_requests (
    employee_id, employee, date, start_time, end_time, hours, reason, store, status, organization_id
  )
  VALUES (
    emp.id, emp.name,
    (p_payload->>'date')::date,
    NULLIF(p_payload->>'start_time', '')::time,
    NULLIF(p_payload->>'end_time', '')::time,
    (p_payload->>'hours')::numeric,
    p_payload->>'reason',
    p_payload->>'store',
    COALESCE(p_payload->>'status', '待審核'),
    emp.organization_id
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_overtime_request(text, json) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.liff_update_overtime_request(p_line_user_id text, p_id int, p_payload json)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees; n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  UPDATE public.overtime_requests SET
    date = (p_payload->>'date')::date,
    start_time = NULLIF(p_payload->>'start_time', '')::time,
    end_time = NULLIF(p_payload->>'end_time', '')::time,
    hours = (p_payload->>'hours')::numeric,
    reason = p_payload->>'reason',
    store = p_payload->>'store'
  WHERE id = p_id AND employee_id = emp.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN json_build_object('updated', n);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_update_overtime_request(text, int, json) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
