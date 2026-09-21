-- ============================================================
-- 薪資卡 PIN 解鎖系統
-- ============================================================
-- 目的：在 LINE BOT 看薪資前要打 4-6 位密碼，避免家人/同事偷看 LINE 通知預覽
-- 設計：
--   - employees.line_pin_hash 存 bcrypt hash（pgcrypto crypt()）
--   - liff_card_set_line_pin       設定/重設密碼
--   - liff_card_my_salary_brief    回 masked 摘要（含 has_pin 旗標）
--   - liff_card_my_salary_unlock   驗證密碼後回完整薪資數字
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS line_pin_hash TEXT;

COMMENT ON COLUMN public.employees.line_pin_hash IS
  'LINE 薪資卡解鎖用 PIN 的 bcrypt hash。NULL = 尚未設定。';


-- ── 1. 設定 PIN ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.liff_card_set_line_pin(
  p_line_user_id text,
  p_pin          text
)
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

  -- 驗證 PIN 格式：4-6 位數字
  IF p_pin !~ '^[0-9]{4,6}$' THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_PIN_FORMAT');
  END IF;

  UPDATE public.employees
     SET line_pin_hash = crypt(p_pin, gen_salt('bf'))
   WHERE id = emp.id;

  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_card_set_line_pin(text, text) TO anon, authenticated;


-- ── 2. 取 masked 摘要（不需要 PIN）──────────────────────────────

CREATE OR REPLACE FUNCTION public.liff_card_my_salary_brief(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp     employees;
  rec     record;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 抓最新一筆薪資
  SELECT id, month, net_salary, created_at
    INTO rec
    FROM public.salary_records
   WHERE employee_id = emp.id
   ORDER BY month DESC, created_at DESC
   LIMIT 1;

  IF rec.id IS NULL THEN
    RETURN json_build_object(
      'ok', true,
      'has_pin', emp.line_pin_hash IS NOT NULL,
      'has_record', false,
      'employee_name', emp.name
    );
  END IF;

  RETURN json_build_object(
    'ok', true,
    'has_pin', emp.line_pin_hash IS NOT NULL,
    'has_record', true,
    'employee_name', emp.name,
    'month', rec.month,
    'net_salary_masked', '$ ' || regexp_replace(rec.net_salary::text, '\d(?=\d{3}$)', '*', 'g')
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_card_my_salary_brief(text) TO anon, authenticated;


-- ── 3. 驗證 PIN 後回完整薪資 ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.liff_card_my_salary_unlock(
  p_line_user_id text,
  p_pin          text
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
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

  IF emp.line_pin_hash <> crypt(p_pin, emp.line_pin_hash) THEN
    RETURN json_build_object('ok', false, 'error', 'WRONG_PIN');
  END IF;

  -- PIN 通過 → 抓最新一筆完整薪資
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
