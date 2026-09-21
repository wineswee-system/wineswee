-- ============================================================
-- 修復 liff_card_set_line_pin / liff_card_my_salary_unlock
--
-- 問題：Supabase 的 pgcrypto 裝在 extensions schema，但 RPC 用了
--       SET search_path = public，找不到 gen_salt / crypt
-- 修法：明確 extensions.gen_salt + extensions.crypt
-- ============================================================

CREATE OR REPLACE FUNCTION public.liff_card_set_line_pin(
  p_line_user_id text,
  p_pin          text
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_pin !~ '^[0-9]{4,6}$' THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_PIN_FORMAT');
  END IF;

  UPDATE public.employees
     SET line_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf'))
   WHERE id = emp.id;

  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_card_set_line_pin(text, text) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.liff_card_my_salary_unlock(
  p_line_user_id text,
  p_pin          text
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  emp        employees;
  rec        record;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF emp.line_pin_hash IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'PIN_NOT_SET');
  END IF;

  IF emp.line_pin_hash <> extensions.crypt(p_pin, emp.line_pin_hash) THEN
    RETURN json_build_object('ok', false, 'error', 'WRONG_PIN');
  END IF;

  SELECT *
    INTO rec
    FROM public.salary_records
   WHERE employee_id = emp.id
   ORDER BY month DESC, created_at DESC
   LIMIT 1;

  IF rec.id IS NULL THEN
    RETURN json_build_object('ok', true, 'has_record', false, 'employee_name', emp.name);
  END IF;

  RETURN json_build_object(
    'ok', true,
    'has_record', true,
    'employee_name', emp.name,
    'month',                rec.month,
    'base_salary',          rec.base_salary,
    'role_allowance',       COALESCE(rec.role_allowance, 0),
    'meal_allowance',       COALESCE(rec.meal_allowance, 0),
    'transport_allowance',  COALESCE(rec.transport_allowance, 0),
    'attendance_bonus',     COALESCE(rec.attendance_bonus, 0),
    'overtime_pay',         COALESCE(rec.overtime_pay, COALESCE(rec.overtime, 0)),
    'bonus',                COALESCE(rec.bonus, 0),
    'allowance_legacy',     COALESCE(rec.allowance, 0),
    'absence_deduction',    COALESCE(rec.absence_deduction, 0),
    'late_deduction',       COALESCE(rec.late_deduction, 0),
    'other_deduction',      COALESCE(rec.other_deduction, 0),
    'other_deduction_note', rec.other_deduction_note,
    'insurance',            rec.insurance,
    'deductions_legacy',    rec.deductions,
    'net_salary',           rec.net_salary,
    'created_at',           rec.created_at
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_card_my_salary_unlock(text, text) TO anon, authenticated;
