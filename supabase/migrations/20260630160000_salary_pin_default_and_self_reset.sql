-- 薪資 PIN 升級：
--   1. 預設密碼 = 身分證後 4 碼（id_number 有值就直接當預設 PIN）
--   2. 員工自助重設：liff_reset_my_salary_pin 清掉自訂 hash → 回到預設

-- ── liff_card_my_salary_brief：補 using_default_pin 欄位 ──────────────────

CREATE OR REPLACE FUNCTION public.liff_card_my_salary_brief(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  emp  employees;
  rec  salary_records;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO rec FROM public.salary_records
   WHERE employee_id = emp.id
   ORDER BY month DESC, created_at DESC LIMIT 1;

  RETURN json_build_object(
    'ok',               true,
    'employee_name',    emp.name,
    'has_pin',          (emp.line_pin_hash IS NOT NULL OR emp.id_number IS NOT NULL),
    'using_default_pin', (emp.line_pin_hash IS NULL AND emp.id_number IS NOT NULL),
    'has_record',       rec.id IS NOT NULL,
    'month',            rec.month,
    'net_salary_masked', CASE WHEN rec.net_salary IS NOT NULL THEN '$ ***,***' ELSE NULL END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_card_my_salary_brief(text) TO anon, authenticated;

-- ── liff_card_my_salary_unlock：支援預設 PIN（身分證後4碼）──────────────────

CREATE OR REPLACE FUNCTION public.liff_card_my_salary_unlock(
  p_line_user_id text,
  p_pin          text
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  emp  employees;
  rec  record;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 驗 PIN：自訂 hash 優先；沒有 hash 就對比身分證後4碼
  IF emp.line_pin_hash IS NOT NULL THEN
    IF emp.line_pin_hash <> extensions.crypt(p_pin, emp.line_pin_hash) THEN
      RETURN json_build_object('ok', false, 'error', 'WRONG_PIN');
    END IF;
  ELSIF emp.id_number IS NOT NULL THEN
    IF p_pin <> RIGHT(emp.id_number, 4) THEN
      RETURN json_build_object('ok', false, 'error', 'WRONG_PIN');
    END IF;
  ELSE
    RETURN json_build_object('ok', false, 'error', 'PIN_NOT_SET');
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
    'employee_name',      emp.name,
    'month',              rec.month,
    'base_salary',        rec.base_salary,
    'role_allowance',     COALESCE(rec.role_allowance, 0),
    'meal_allowance',     COALESCE(rec.meal_allowance, 0),
    'transport_allowance',COALESCE(rec.transport_allowance, 0),
    'attendance_bonus',   COALESCE(rec.attendance_bonus, 0),
    'overtime_pay',       COALESCE(rec.overtime_pay, COALESCE(rec.overtime, 0)),
    'bonus',              COALESCE(rec.bonus, 0),
    'allowance_legacy',   COALESCE(rec.allowance, 0),
    'absence_deduction',  COALESCE(rec.absence_deduction, 0),
    'late_deduction',     COALESCE(rec.late_deduction, 0),
    'other_deduction',    COALESCE(rec.other_deduction, 0),
    'other_deduction_note', rec.other_deduction_note,
    'insurance',          rec.insurance,
    'deductions_legacy',  rec.deductions,
    'net_salary',         rec.net_salary,
    'created_at',         rec.created_at
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_card_my_salary_unlock(text, text) TO anon, authenticated;

-- ── liff_reset_my_salary_pin：員工自助重設（清回預設）──────────────────────

CREATE OR REPLACE FUNCTION public.liff_reset_my_salary_pin(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;
  IF emp.id_number IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_DEFAULT_PIN');
  END IF;

  UPDATE public.employees SET line_pin_hash = NULL WHERE id = emp.id;
  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_reset_my_salary_pin(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
