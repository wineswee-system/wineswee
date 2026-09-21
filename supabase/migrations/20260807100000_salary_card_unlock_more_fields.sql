-- LINE 薪資卡解鎖 RPC 補回細項欄位:custom_allowances/勞保健保拆分/勞退/所得稅/特休折現 — 2026-08-07
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:liff_card_my_salary_unlock 原本只回 role/meal/transport + insurance 合計,
--   沒回 custom_allowances(夜班/跨店等) → 卡片把這些津貼塞進「其他加項」,與薪資袋不一致
--   (薪資袋有逐項列)。補回這些欄位,卡片才能逐項對齊薪資袋。
-- 純加回傳欄位,不改 PIN 驗證/發布閘門邏輯,body 與 20260713160000 逐字一致。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.liff_card_my_salary_unlock(p_line_user_id text, p_pin text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
     AND published_at IS NOT NULL          -- ★ 只看已發布月份（草稿不外洩）
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
    'custom_allowances',  COALESCE(rec.custom_allowances, '[]'::jsonb),
    'unused_leave_payout',COALESCE(rec.unused_leave_payout, 0),
    'absence_deduction',  COALESCE(rec.absence_deduction, 0),
    'late_deduction',     COALESCE(rec.late_deduction, 0),
    'other_deduction',    COALESCE(rec.other_deduction, 0),
    'other_deduction_note', rec.other_deduction_note,
    'insurance',          rec.insurance,
    'labor_insurance',    COALESCE(rec.labor_insurance, 0),
    'health_insurance',   COALESCE(rec.health_insurance, 0),
    'pension_self',       COALESCE(rec.pension_self, 0),
    'income_tax',         COALESCE(rec.income_tax, 0),
    'deductions_legacy',  rec.deductions,
    'net_salary',         rec.net_salary,
    'created_at',         rec.created_at
  );
END $function$;
