-- ════════════════════════════════════════════════════════════
-- M3 接續：把 LIFF liff_insert_clock_correction 的 type 預設值
--          從中文 '上班打卡' 改成英文 'clock_in'，並把任何中文輸入
--          收斂成英文，讓 DB 永遠只存 clock_in / clock_out。
--
-- 為何不改 LIFF 端：LIFF repo 是另一個專案，這邊改 RPC 拿到舊 LIFF
-- 送來的中文也能正常吃，向下相容。
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_insert_clock_correction(p_line_user_id text, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
  new_id int;
  v_type_in  text;
  v_type_out text;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  v_type_in := COALESCE(p_payload->>'type', 'clock_in');
  v_type_out := CASE v_type_in
                  WHEN '上班打卡' THEN 'clock_in'
                  WHEN '下班打卡' THEN 'clock_out'
                  ELSE v_type_in
                END;

  INSERT INTO public.clock_corrections (
    employee, employee_id, date, type, correction_time, reason, store, status, organization_id
  )
  VALUES (
    emp.name,
    emp.id,
    (p_payload->>'date')::date,
    v_type_out,
    NULLIF(p_payload->>'correction_time', '')::time,
    p_payload->>'reason',
    p_payload->>'store',
    '待審核',
    emp.organization_id
  )
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id);
END $function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
