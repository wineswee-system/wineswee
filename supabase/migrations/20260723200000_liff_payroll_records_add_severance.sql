-- LIFF 員工查薪官方薪資單補資遣費/特休折現欄 — 2026-07-23
-- ════════════════════════════════════════════════════════════════════════════
-- liff_get_my_payroll_records 用明列 json_build_object,原本漏回傳:
--   unused_leave_payout/unused_leave_days(特休折現)、severance_amount/notice_wage/
--   severance_total(資遣金,20260723180000/190000 已入 payroll_records)、is_final_settlement。
-- 補這幾欄,員工 LIFF 正式薪資單才列得出「資遣費/預告工資/未休特休折現」。
-- 其餘與 live 逐字一致,只在 custom_allowances_breakdown 後、gross_salary 前插欄。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.liff_get_my_payroll_records(p_line_user_id text, p_limit integer DEFAULT 6)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'records', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',                          sub.id,
        'pay_period',                  sub.pay_period,
        'base_salary',                 sub.base_salary,
        'role_allowance',              sub.role_allowance,
        'meal_allowance',              sub.meal_allowance,
        'transport_allowance',         sub.transport_allowance,
        'attendance_bonus_earned',     sub.attendance_bonus_earned,
        'overtime_pay',                sub.overtime_pay,
        'custom_allowances_total',     sub.custom_allowances_total,
        'custom_allowances_breakdown', sub.custom_allowances_breakdown,
        'unused_leave_payout',         sub.unused_leave_payout,
        'unused_leave_days',           sub.unused_leave_days,
        'severance_amount',            sub.severance_amount,
        'notice_wage',                 sub.notice_wage,
        'severance_total',             sub.severance_total,
        'is_final_settlement',         sub.is_final_settlement,
        'gross_salary',                sub.gross_salary,
        'leave_deduction',             sub.leave_deduction,
        'late_deduction',              sub.late_deduction,
        'labor_ins_employee',          sub.labor_ins_employee,
        'health_ins_employee',         sub.health_ins_employee,
        'legal_deduction_total',       sub.legal_deduction_total,
        'legal_deduction_breakdown',   sub.legal_deduction_breakdown,
        'total_deductions',            sub.total_deductions,
        'net_salary',                  sub.net_salary
      ) ORDER BY sub.pay_period DESC), '[]'::json)
      FROM (
        SELECT * FROM public.payroll_records pr
        WHERE pr.employee_id = emp.id
        ORDER BY pr.pay_period DESC
        LIMIT p_limit
      ) sub
    )
  );
END $function$;

NOTIFY pgrst, 'reload schema';
