-- ════════════════════════════════════════════════════════════════════════════
-- B2.2：入帳 generate_payroll 改呼叫試算 _compute_payroll_for_employee（試算=入帳）
-- 2026-06-25
--
-- 入帳不再自己算,改成每位員工呼叫 _compute(=試算同一支),把回傳 jsonb 寫進 payroll_records。
-- → 數字保證 = 試算(加班deem/國定8h/遲到早退/覈實保險/不代扣稅/二代健保/特休結清全到位)。
-- 保留入帳專屬副作用(試算唯讀不做)：
--   1) legal_deductions 餘額更新(paid_amount/paid_months/完成)
--   2) annual_bonus_tracker 年度獎金累計
--   3) nhi_supplementary_records 二代健保明細
-- 員工範圍沿用入帳原本(在職 + 當月離職);payroll_records 欄位對應 _compute 回傳。
--
-- ⚠️ payroll_records 目前空、沒結算過 → 風險低。請先測試月生成 draft、逐人比對試算後才正式用。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_payroll(
  p_pay_period CHARACTER,
  p_created_by INTEGER DEFAULT NULL::integer
)
RETURNS TABLE(payroll_run_id INTEGER, records_created INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_run_id      INT;
  v_count       INT := 0;
  v_year        INT := SPLIT_PART(p_pay_period, '-', 1)::INT;
  rec           RECORD;
  c             JSONB;                 -- _compute 回傳
  v_record_id   INT;
  -- 法定扣款副作用
  v_lr          RECORD;
  v_legal_deduct NUMERIC;
  v_legal_breakdown JSONB;
  -- 年度獎金累計副作用
  v_bonus       NUMERIC;
  v_insured     NUMERIC;
  v_prev        NUMERIC;
  v_newc        NUMERIC;
  v_4x          NUMERIC;
BEGIN
  INSERT INTO payroll_runs (pay_period, status, created_by)
  VALUES (p_pay_period, 'draft', p_created_by)
  RETURNING id INTO v_run_id;

  FOR rec IN
    SELECT e.id AS employee_id, e.organization_id, e.status
    FROM employees e
    WHERE (e.join_date IS NULL OR e.join_date <= (date_trunc('month', to_date(p_pay_period,'YYYY-MM')) + interval '1 month - 1 day')::date)
      AND (
        e.status = '在職'
        OR (e.status = '離職'
            AND e.resign_date IS NOT NULL
            AND e.resign_date >= date_trunc('month', to_date(p_pay_period,'YYYY-MM'))::date
            AND e.resign_date <= (date_trunc('month', to_date(p_pay_period,'YYYY-MM')) + interval '1 month - 1 day')::date)
      )
  LOOP
    -- ── 數字一律取自試算 _compute（=試算=入帳）──
    c := public._compute_payroll_for_employee(rec.employee_id, p_pay_period);
    IF c IS NULL THEN CONTINUE; END IF;

    -- ── 副作用1：法定扣款餘額更新（對齊 _compute 的「fixed 加總」；cap 至剩餘）──
    v_legal_breakdown := '[]'::jsonb;
    FOR v_lr IN
      SELECT id, title, monthly_amount, total_amount, paid_amount
      FROM legal_deductions
      WHERE employee_id = rec.employee_id
        AND status = '進行中'
        AND started_month <= p_pay_period
        AND (deduction_type = 'fixed' OR deduction_type IS NULL)
      ORDER BY id
    LOOP
      v_legal_deduct := GREATEST(LEAST(v_lr.monthly_amount, v_lr.total_amount - v_lr.paid_amount), 0);
      IF v_legal_deduct > 0 THEN
        UPDATE legal_deductions
           SET paid_amount = paid_amount + v_legal_deduct,
               paid_months = paid_months + 1,
               status      = CASE WHEN (paid_amount + v_legal_deduct) >= total_amount THEN '已完成' ELSE status END,
               updated_at  = NOW()
         WHERE id = v_lr.id;
      END IF;
      v_legal_breakdown := v_legal_breakdown || jsonb_build_object(
        'id', v_lr.id, 'title', v_lr.title, 'monthly_amount', v_lr.monthly_amount, 'amount', v_legal_deduct);
    END LOOP;

    -- ── 寫 payroll_records（欄位全取 _compute）──
    INSERT INTO payroll_records (
      payroll_run_id, employee_id, pay_period,
      base_salary, role_allowance, meal_allowance, transport_allowance,
      attendance_bonus_earned, overtime_pay, ot_hours_weekday, ot_hours_holiday,
      custom_allowances_total, custom_allowances_breakdown,
      gross_salary,
      income_tax_withheld,
      leave_deduction, leave_days_deducted, late_deduction, late_minutes,
      labor_ins_employee, health_ins_employee, labor_pension_employee,
      nhi_supplementary, nhi_supplementary_breakdown,
      unused_leave_payout, unused_leave_days, is_final_settlement,
      legal_deduction_total, legal_deduction_breakdown,
      total_deductions,
      labor_ins_employer, health_ins_employer, labor_pension_employer,
      net_salary, hours_worked,
      prorate_ratio, actual_work_days
    ) VALUES (
      v_run_id, rec.employee_id, p_pay_period,
      (c->>'base_salary')::numeric, (c->>'role_allowance')::numeric, (c->>'meal_allowance')::numeric, (c->>'transport_allowance')::numeric,
      (c->>'attendance_bonus')::numeric, (c->>'overtimePay')::numeric,
      (c->>'otWeekday')::numeric, ((c->>'otRestday')::numeric + (c->>'otWeeklyOff')::numeric + (c->>'otHoliday')::numeric),
      (c->>'custom_allowances_total')::numeric, COALESCE(c->'custom_allowances','[]'::jsonb),
      (c->>'gross')::numeric,
      0,                                      -- 所得稅不代扣（政策）
      (c->>'absenceDeduction')::numeric, (c->>'absenceDays')::numeric, (c->>'lateDeduction')::numeric, (c->>'lateMins')::numeric,
      (c->>'laborInsurance')::numeric, (c->>'healthInsurance')::numeric, (c->>'pension')::numeric,
      (c->>'nhi_supplementary')::numeric, COALESCE(c->'nhi_supplementary_breakdown','[]'::jsonb),
      (c->>'unused_leave_payout')::numeric, (c->>'unused_leave_days')::numeric, (c->>'is_final_settlement')::boolean,
      (c->>'legal_deduction')::numeric, v_legal_breakdown,
      (c->>'totalDeductions')::numeric,
      (c->>'laborEmployer')::numeric, (c->>'healthEmployer')::numeric, (c->>'pensionEmployer')::numeric,
      (c->>'netSalary')::numeric, (c->>'workHours')::numeric,
      (c->>'salary_prorate_ratio')::numeric, (c->>'salary_actual_wd')::int
    ) RETURNING id INTO v_record_id;

    -- ── 副作用2：二代健保明細 records ──
    IF (c->>'nhi_supplementary')::numeric > 0 THEN
      INSERT INTO nhi_supplementary_records (
        payroll_record_id, employee_id, pay_period, organization_id,
        income_category, income_amount, exempt_amount, taxable_amount, rate, premium_amount
      )
      SELECT v_record_id, rec.employee_id, p_pay_period, rec.organization_id,
        (item->>'category'), (item->>'income')::numeric, COALESCE((item->>'exempt')::numeric,0),
        (item->>'taxable')::numeric, (item->>'rate')::numeric, (item->>'premium')::numeric
      FROM jsonb_array_elements(c->'nhi_supplementary_breakdown') AS item
      WHERE (item->>'premium')::numeric > 0;
    END IF;

    -- ── 副作用3：年度獎金累計（門檻用覈實投保,對齊 _compute 的二代健保）──
    v_bonus := (c->>'attendance_bonus')::numeric;
    v_insured := (c->>'insuredHealth')::numeric;
    IF v_bonus > 0 AND v_insured > 0 THEN
      v_4x := v_insured * 4;
      SELECT cumulative_bonus INTO v_prev FROM annual_bonus_tracker
       WHERE employee_id = rec.employee_id AND year = v_year;
      v_prev := COALESCE(v_prev, 0);
      v_newc := v_prev + v_bonus;
      INSERT INTO annual_bonus_tracker (employee_id, year, organization_id, cumulative_bonus, insured_salary, threshold, exceeded_at)
      VALUES (rec.employee_id, v_year, rec.organization_id, v_newc, v_insured, v_4x, CASE WHEN v_newc > v_4x THEN NOW() ELSE NULL END)
      ON CONFLICT (employee_id, year) DO UPDATE SET
        cumulative_bonus = EXCLUDED.cumulative_bonus, insured_salary = EXCLUDED.insured_salary,
        threshold = EXCLUDED.threshold, exceeded_at = COALESCE(annual_bonus_tracker.exceeded_at, EXCLUDED.exceeded_at),
        updated_at = NOW();
    END IF;

    v_count := v_count + 1;
  END LOOP;

  payroll_run_id  := v_run_id;
  records_created := v_count;
  RETURN NEXT;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
