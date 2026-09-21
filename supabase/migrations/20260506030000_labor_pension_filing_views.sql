-- =============================================
-- 薪資系統 補強 Phase 4 — 勞退提繳清冊 + 二代健保申報 view
--
-- 提供月度匯出申報資料：
--   1. v_labor_pension_filing_monthly  → 勞退提繳清冊（每月雇主 6% + 員工自提）
--   2. v_nhi_supplementary_filing      → 二代健保補充保費申報明細
--   3. v_payroll_summary_monthly       → 月度薪資總表（含所有新增欄位）
-- =============================================

BEGIN;

-- ── 1. 勞退提繳清冊 ──
CREATE OR REPLACE VIEW public.v_labor_pension_filing_monthly AS
SELECT
  pr.pay_period,
  e.id                      AS employee_id,
  e.name                    AS employee_name,
  e.id_number               AS id_number,
  e.organization_id,
  pr.base_salary            AS pension_base,            -- 提繳基礎（底薪，封頂 150,000）
  LEAST(pr.base_salary, 150000) AS capped_pension_base,
  pr.labor_pension_employer AS employer_contribution,    -- 雇主 6%
  pr.labor_pension_employee AS employee_contribution,    -- 員工自提
  COALESCE(e.labor_pension_self_rate, 0) AS employee_rate_pct,
  pr.labor_pension_employer + pr.labor_pension_employee AS total_contribution,
  pr.payroll_run_id,
  pr.created_at
FROM payroll_records pr
JOIN employees e ON e.id = pr.employee_id
WHERE pr.labor_pension_employer > 0
   OR pr.labor_pension_employee > 0
ORDER BY pr.pay_period DESC, e.name;

COMMENT ON VIEW public.v_labor_pension_filing_monthly IS
  '勞退月提繳清冊：每月每員工提繳明細，可匯出 CSV 給勞工保險局申報';


-- ── 2. 二代健保補充保費申報明細 ──
CREATE OR REPLACE VIEW public.v_nhi_supplementary_filing AS
SELECT
  ns.pay_period,
  e.id                       AS employee_id,
  e.name                     AS employee_name,
  e.id_number                AS id_number,
  e.organization_id,
  ns.income_category         AS category,
  ns.income_amount           AS gross_income,
  ns.exempt_amount           AS exempt_amount,
  ns.taxable_amount          AS taxable_amount,
  ns.rate                    AS premium_rate,
  ns.premium_amount          AS premium,
  ns.filed,
  ns.filed_at,
  ns.notes,
  ns.id                      AS record_id,
  ns.created_at
FROM nhi_supplementary_records ns
JOIN employees e ON e.id = ns.employee_id
ORDER BY ns.pay_period DESC, ns.income_category, e.name;

COMMENT ON VIEW public.v_nhi_supplementary_filing IS
  '二代健保補充保費申報明細：可匯出給健保署申報';


-- ── 3. 月度薪資總表（HR 報表用）──
CREATE OR REPLACE VIEW public.v_payroll_summary_monthly AS
SELECT
  pr.pay_period,
  pr.payroll_run_id,
  e.id                       AS employee_id,
  e.name                     AS employee_name,
  e.organization_id,
  e.dept,
  e.position,
  e.status                   AS employee_status,
  -- 收入
  pr.base_salary,
  pr.role_allowance,
  pr.meal_allowance,
  pr.transport_allowance,
  pr.attendance_bonus_earned,
  pr.overtime_pay,
  pr.ot_hours_weekday,
  pr.ot_hours_holiday,
  pr.custom_allowances_total,
  pr.year_end_bonus,
  pr.unused_leave_payout,
  pr.unused_leave_days,
  pr.gross_salary,
  -- 扣項
  pr.leave_deduction,
  pr.leave_days_deducted,
  pr.late_deduction,
  pr.late_minutes,
  pr.labor_ins_employee,
  pr.health_ins_employee,
  pr.labor_pension_employee,
  pr.income_tax_withheld,
  pr.nhi_supplementary,
  pr.legal_deduction_total,
  pr.total_deductions,
  -- 雇主負擔
  pr.labor_ins_employer,
  pr.health_ins_employer,
  pr.labor_pension_employer,
  -- 實發
  pr.net_salary,
  pr.is_final_settlement,
  pr.payslip_sent_at,
  pr.created_at
FROM payroll_records pr
JOIN employees e ON e.id = pr.employee_id
ORDER BY pr.pay_period DESC, e.name;

COMMENT ON VIEW public.v_payroll_summary_monthly IS
  '月度薪資總表：含所有收入扣項欄位，可直接匯出給會計／審計';


GRANT SELECT ON public.v_labor_pension_filing_monthly TO authenticated;
GRANT SELECT ON public.v_nhi_supplementary_filing       TO authenticated;
GRANT SELECT ON public.v_payroll_summary_monthly        TO authenticated;

COMMIT;
