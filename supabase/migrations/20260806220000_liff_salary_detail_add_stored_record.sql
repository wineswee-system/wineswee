-- LIFF 薪資查詢:多回發布版存的欄位(record) — 舊月引擎現算漂移時前端改讀存的 — 2026-08-06
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:薪資袋細項=引擎現算(_compute_payroll_for_employee),舊月份底層出勤/排班/員工
--   資料事後被改 → 引擎算不回當初(如四月本薪塌成1567,差額全塞「其他加項」)。
--   實領本來就以發布版 net_salary 為準(不受影響),但細項會漂。
-- 修:RPC 額外回傳 salary_records 發布當下存的細項欄位(record)。前端在「引擎明細對不回
--   發布版」時,改用 record 顯示(粗但正確、定版不漂);對得回就維持引擎最細明細。
--   純加一個回傳欄位,不改引擎、不改金額、不改既有 detail/adjustments/published_net。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_get_my_salary_detail(p_line_user_id text, p_period text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  emp      public.employees;
  v_rec    public.salary_records;
  v_detail json;
  v_adjs   json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_rec FROM public.salary_records
   WHERE (employee_id = emp.id OR employee = emp.name)
     AND month = p_period
     AND published_at IS NOT NULL
   ORDER BY id DESC LIMIT 1;
  IF v_rec.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PUBLISHED');
  END IF;

  v_detail := public._compute_payroll_for_employee(emp.id, p_period);

  SELECT COALESCE(json_agg(json_build_object(
           'source_type', source_type,
           'amount',      (new_value->>'amount')::numeric,
           'label',       new_value->>'label')), '[]'::json)
    INTO v_adjs
    FROM public.salary_adjustments
   WHERE salary_record_id = v_rec.id
     AND source_type IN ('manual_bonus','manual_backpay','manual_deduction')
     AND superseded_at IS NULL;

  RETURN json_build_object(
    'ok',            true,
    'period',        p_period,
    'detail',        v_detail,          -- 引擎現算完整明細(對得回發布版時用)
    'adjustments',   v_adjs,            -- 逐筆微調
    'published_net', v_rec.net_salary,  -- ★ 實領以發布版為準(定額不浮動)
    'published_at',  v_rec.published_at,
    -- ★ 發布當下存的細項欄位:引擎對不回發布版時前端改讀這個(定版不漂,粗但正確)
    'record', json_build_object(
      'base_salary',         v_rec.base_salary,
      'allowance',           v_rec.allowance,
      'overtime',            v_rec.overtime,
      'overtime_pay',        v_rec.overtime_pay,
      'bonus',               v_rec.bonus,
      'role_allowance',      v_rec.role_allowance,
      'meal_allowance',      v_rec.meal_allowance,
      'transport_allowance', v_rec.transport_allowance,
      'attendance_bonus',    v_rec.attendance_bonus,
      'custom_allowances',   v_rec.custom_allowances,
      'unused_leave_payout', v_rec.unused_leave_payout,
      'insurance',           v_rec.insurance,
      'labor_insurance',     v_rec.labor_insurance,
      'health_insurance',    v_rec.health_insurance,
      'pension_self',        v_rec.pension_self,
      'late_deduction',      v_rec.late_deduction,
      'absence_deduction',   v_rec.absence_deduction,
      'other_deduction',     v_rec.other_deduction,
      'income_tax',          v_rec.income_tax,
      'deductions',          v_rec.deductions,
      'net_salary',          v_rec.net_salary
    )
  );
END $function$;

REVOKE ALL ON FUNCTION public.liff_get_my_salary_detail(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.liff_get_my_salary_detail(text, text) TO anon, authenticated;
