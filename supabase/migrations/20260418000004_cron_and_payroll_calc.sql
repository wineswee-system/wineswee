-- ============================================================
-- 1. task-reminder cron job（每 15 分鐘）
-- 2. 薪資計算 Postgres Function
-- 2026-04-18
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- SECTION 1: task-reminder Cron Jobs
-- ═══════════════════════════════════════════════════════════

-- 需要 pg_cron + pg_net 擴展
-- Supabase Pro plan 才有 pg_cron，Free plan 可用 Supabase Scheduled Functions 代替

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- 每 15 分鐘：檢查 reminder_at 到期的任務
    BEGIN PERFORM cron.unschedule('task_reminder_15min'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'task_reminder_15min',
      '*/15 * * * *',
      $$SELECT extensions.http_post(
        url := current_setting('supabase.url') || '/functions/v1/task-reminder',
        body := '{"mode":"reminders"}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
        )
      )$$
    );

    -- 每天早上 8:00 (台北 = UTC 0:00)：檢查逾期 + 即將到期
    BEGIN PERFORM cron.unschedule('task_reminder_daily'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'task_reminder_daily',
      '0 0 * * *',
      $$SELECT extensions.http_post(
        url := current_setting('supabase.url') || '/functions/v1/task-reminder',
        body := '{"mode":"all"}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
        )
      )$$
    );

  ELSE
    RAISE NOTICE 'pg_cron not available — use Supabase Dashboard to set up scheduled functions instead';
  END IF;
END$outer$;


-- ═══════════════════════════════════════════════════════════
-- SECTION 2: 薪資計算 Function
-- 從 salary_structures + attendance + leave + overtime
-- 一鍵計算出 payroll_records
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.generate_payroll(
  p_pay_period CHAR(7),        -- e.g. '2026-04'
  p_created_by INT DEFAULT NULL
)
RETURNS TABLE(payroll_run_id INT, records_created INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_run_id INT;
  v_count INT := 0;
  v_year INT;
  v_month INT;
  v_month_start DATE;
  v_month_end DATE;
  v_work_days INT;
  rec RECORD;
BEGIN
  -- Parse period
  v_year := SPLIT_PART(p_pay_period, '-', 1)::INT;
  v_month := SPLIT_PART(p_pay_period, '-', 2)::INT;
  v_month_start := MAKE_DATE(v_year, v_month, 1);
  v_month_end := (v_month_start + INTERVAL '1 month - 1 day')::DATE;

  -- Count work days (exclude weekends) — rough estimate
  SELECT COUNT(*) INTO v_work_days
  FROM generate_series(v_month_start, v_month_end, '1 day') d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);

  -- Create payroll run
  INSERT INTO payroll_runs (pay_period, status, created_by)
  VALUES (p_pay_period, 'draft', p_created_by)
  RETURNING id INTO v_run_id;

  -- Loop through all active employees with salary structures
  FOR rec IN
    SELECT
      e.id AS employee_id,
      e.name,
      ss.base_salary,
      ss.role_allowance,
      ss.meal_allowance,
      ss.transport_allowance,
      ss.attendance_bonus,
      ss.salary_type,
      ss.hourly_rate,
      ss.health_ins_dependents,
      e.labor_ins_grade,
      e.health_ins_grade
    FROM employees e
    JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE e.status = '在職'
  LOOP
    DECLARE
      v_base NUMERIC(10,2) := rec.base_salary;
      v_role_allow NUMERIC(10,2) := rec.role_allowance;
      v_meal NUMERIC(10,2) := rec.meal_allowance;
      v_transport NUMERIC(10,2) := rec.transport_allowance;
      v_attendance_bonus NUMERIC(10,2) := rec.attendance_bonus;
      v_ot_pay NUMERIC(10,2) := 0;
      v_ot_hours_wd NUMERIC(5,2) := 0;
      v_ot_hours_hd NUMERIC(5,2) := 0;
      v_gross NUMERIC(10,2);
      v_leave_deduction NUMERIC(10,2) := 0;
      v_leave_days NUMERIC(4,1) := 0;
      v_late_deduction NUMERIC(10,2) := 0;
      v_late_mins INT := 0;
      v_labor_emp NUMERIC(10,2) := 0;
      v_labor_er NUMERIC(10,2) := 0;
      v_health_emp NUMERIC(10,2) := 0;
      v_health_er NUMERIC(10,2) := 0;
      v_pension_emp NUMERIC(10,2) := 0;
      v_pension_er NUMERIC(10,2) := 0;
      v_total_deductions NUMERIC(10,2);
      v_net NUMERIC(10,2);
      v_hours_worked NUMERIC(6,2) := 0;
      v_daily_rate NUMERIC(10,2);
      v_hourly_rate NUMERIC(10,2);
    BEGIN
      -- Calculate daily/hourly rate
      IF rec.salary_type = 'hourly' THEN
        v_hourly_rate := rec.hourly_rate;
        -- Get actual hours worked from attendance
        SELECT COALESCE(SUM(total_hours), 0) INTO v_hours_worked
        FROM attendance_records
        WHERE employee_id = rec.employee_id
          AND date >= v_month_start AND date <= v_month_end;
        v_base := v_hourly_rate * v_hours_worked;
      ELSE
        v_daily_rate := v_base / v_work_days;
        v_hourly_rate := v_daily_rate / 8;
        -- Get hours worked
        SELECT COALESCE(SUM(total_hours), 0) INTO v_hours_worked
        FROM attendance_records
        WHERE employee_id = rec.employee_id
          AND date >= v_month_start AND date <= v_month_end;
      END IF;

      -- Overtime pay (approved OT only)
      SELECT
        COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM request_date) IN (0, 6) THEN 0 ELSE ot_hours END), 0),
        COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM request_date) IN (0, 6) THEN ot_hours ELSE 0 END), 0)
      INTO v_ot_hours_wd, v_ot_hours_hd
      FROM overtime_requests
      WHERE employee_id = rec.employee_id
        AND request_date >= v_month_start AND request_date <= v_month_end
        AND status = '已核准'
        AND (ot_type IS NULL OR ot_type = 'pay');

      -- OT rate: weekday 1.34x, holiday 2x (Taiwan labor law)
      v_ot_pay := (v_ot_hours_wd * v_hourly_rate * 1.34) + (v_ot_hours_hd * v_hourly_rate * 2);

      -- Leave deductions (unpaid leave / 事假)
      SELECT COALESCE(SUM(days), 0) INTO v_leave_days
      FROM leave_requests
      WHERE employee_id = rec.employee_id
        AND start_date >= v_month_start AND end_date <= v_month_end
        AND status = '已核准'
        AND leave_type IN ('事假', 'personal', '無薪假', 'unpaid');

      IF rec.salary_type = 'monthly' THEN
        v_leave_deduction := v_leave_days * v_daily_rate;
      END IF;

      -- Late deductions
      SELECT COALESCE(SUM(late_minutes), 0) INTO v_late_mins
      FROM attendance_records
      WHERE employee_id = rec.employee_id
        AND date >= v_month_start AND date <= v_month_end
        AND is_late = true;

      -- Late penalty: deduct per 30-min block (company policy)
      v_late_deduction := FLOOR(v_late_mins / 30.0) * (v_hourly_rate * 0.5);

      -- Attendance bonus: only if no late and no absences
      IF v_late_mins > 0 OR v_leave_days > 0 THEN
        v_attendance_bonus := 0;
      END IF;

      -- Gross salary
      v_gross := v_base + v_role_allow + v_meal + v_transport + v_attendance_bonus + v_ot_pay;

      -- Labor insurance (from brackets)
      IF rec.labor_ins_grade IS NOT NULL THEN
        SELECT employee_premium, employer_premium INTO v_labor_emp, v_labor_er
        FROM labor_ins_brackets
        WHERE year = v_year AND grade = rec.labor_ins_grade;
      END IF;

      -- Health insurance (from brackets, with dependents)
      IF rec.health_ins_grade IS NOT NULL THEN
        SELECT employee_premium, employer_premium INTO v_health_emp, v_health_er
        FROM health_ins_brackets
        WHERE year = v_year AND grade = rec.health_ins_grade;
        -- Dependents share employee bracket
        v_health_emp := v_health_emp * (1 + rec.health_ins_dependents);
      END IF;

      -- Labor pension (employer 6% mandatory, employee optional)
      v_pension_er := v_gross * 0.06;
      -- Employee voluntary contribution (default 0, can be set in salary_structures)

      -- Total deductions
      v_total_deductions := v_leave_deduction + v_late_deduction + v_labor_emp + v_health_emp + v_pension_emp;

      -- Net salary
      v_net := v_gross - v_total_deductions;

      -- Insert payroll record
      INSERT INTO payroll_records (
        payroll_run_id, employee_id, pay_period,
        base_salary, role_allowance, meal_allowance, transport_allowance,
        attendance_bonus_earned, overtime_pay, ot_hours_weekday, ot_hours_holiday,
        gross_salary,
        leave_deduction, leave_days_deducted, late_deduction, late_minutes,
        labor_ins_employee, health_ins_employee, labor_pension_employee,
        total_deductions,
        labor_ins_employer, health_ins_employer, labor_pension_employer,
        net_salary, hours_worked
      ) VALUES (
        v_run_id, rec.employee_id, p_pay_period,
        v_base, v_role_allow, v_meal, v_transport,
        v_attendance_bonus, v_ot_pay, v_ot_hours_wd, v_ot_hours_hd,
        v_gross,
        v_leave_deduction, v_leave_days, v_late_deduction, v_late_mins,
        v_labor_emp, v_health_emp, v_pension_emp,
        v_total_deductions,
        v_labor_er, v_health_er, v_pension_er,
        v_net, v_hours_worked
      );

      v_count := v_count + 1;
    END;
  END LOOP;

  payroll_run_id := v_run_id;
  records_created := v_count;
  RETURN NEXT;
END;
$$;

COMMIT;
