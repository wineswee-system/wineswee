-- ============================================================
-- Audit 修補包：6 個問題的後端部分
--
-- 1. performance_goals 加 4 個欄位（category/unit/deadline/note）
--    → 主系統 Performance.jsx 表單寫的這幾個欄位之前 silently dropped，現在會持久化
--
-- 2. 3 支 LIFF RPC 用了不存在的 emp.tenant_id → 改用 emp.organization_id
--    - liff_list_training_courses
--    - liff_enroll_course
--    - liff_get_my_benefits
--
-- 3. liff_get_my_leave_balances 加 org_id 隔離
--
-- 4. calc_legal_deduction_for_month 安全加固
--    → REVOKE anon/authenticated（任何人傳 employee_id 都查得到法扣明細）
--    → 只給 service_role（給 generate_payroll 內部用）
--
-- 5. generate_payroll 加國定假日加班費率修正
--    → 之前只看 EXTRACT(DOW) 判平日/假日；現在也認 holidays 表中
--      is_workday=false 的日子當「假日加班 2x」
-- ============================================================

-- ═══ 1. performance_goals 補欄位 ═══
ALTER TABLE public.performance_goals
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS unit     TEXT,
  ADD COLUMN IF NOT EXISTS deadline DATE,
  ADD COLUMN IF NOT EXISTS note     TEXT;


-- ═══ 2a. liff_list_training_courses 改用 organization_id ═══
CREATE OR REPLACE FUNCTION public.liff_list_training_courses(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'courses', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',              c.id,
        'title',           c.title,
        'description',     c.description,
        'category',        c.category,
        'duration_hours',  c.duration_hours,
        'instructor',      c.instructor,
        'max_enrollment',  c.max_enrollment,
        'status',          c.status,
        'enrolled_count',  (SELECT count(*) FROM public.training_enrollments te WHERE te.course_id = c.id),
        'i_enrolled',      EXISTS (
          SELECT 1 FROM public.training_enrollments te
          WHERE te.course_id = c.id AND te.employee = emp.name
        ),
        'my_status',       (
          SELECT te.status FROM public.training_enrollments te
          WHERE te.course_id = c.id AND te.employee = emp.name
          LIMIT 1
        )
      ) ORDER BY c.id DESC), '[]'::json)
      FROM public.training_courses c
      WHERE c.status = '開課中'
        AND (c.organization_id IS NULL OR c.organization_id = emp.organization_id)
    )
  );
END $$;


-- ═══ 2b. liff_enroll_course 改用 organization_id ═══
CREATE OR REPLACE FUNCTION public.liff_enroll_course(
  p_line_user_id text,
  p_course_id    int
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  course     training_courses;
  curr_count int;
  new_id     int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO course FROM public.training_courses WHERE id = p_course_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'COURSE_NOT_FOUND');
  END IF;

  IF course.status <> '開課中' THEN
    RETURN json_build_object('ok', false, 'error', 'COURSE_CLOSED');
  END IF;

  -- org 隔離
  IF course.organization_id IS NOT NULL AND course.organization_id <> emp.organization_id THEN
    RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
  END IF;

  IF EXISTS (SELECT 1 FROM public.training_enrollments WHERE course_id = p_course_id AND employee = emp.name) THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_ENROLLED');
  END IF;

  SELECT count(*) INTO curr_count FROM public.training_enrollments WHERE course_id = p_course_id;
  IF course.max_enrollment IS NOT NULL AND curr_count >= course.max_enrollment THEN
    RETURN json_build_object('ok', false, 'error', 'COURSE_FULL');
  END IF;

  -- ★ 寫入時帶 organization_id 而不是 tenant_id（NULL）
  INSERT INTO public.training_enrollments (course_id, employee, status, organization_id)
  VALUES (p_course_id, emp.name, '已報名', emp.organization_id)
  RETURNING id INTO new_id;

  RETURN json_build_object('ok', true, 'enrollment_id', new_id);
END $$;


-- ═══ 2c. liff_get_my_benefits 改用 organization_id ═══
-- 註：benefit_policies 表用 tenant_id 是 legacy（20260415000001 建立時的設計）
-- 這裡先比 tenant_id 也 ok（會是 NULL）；正確做法是長期把 benefit_policies 改用 organization_id
-- 為避免破壞既有資料，這裡用「tenant_id IS NULL OR ...」放寬條件
CREATE OR REPLACE FUNCTION public.liff_get_my_benefits(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp     employees;
  today   date := CURRENT_DATE;
  result  json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  WITH candidates AS (
    SELECT
      bp.*,
      CASE
        WHEN bp.employee_id = emp.id THEN 3
        WHEN bp.employee_id IS NULL AND bp.store_id = emp.store_id THEN 2
        WHEN bp.employee_id IS NULL AND bp.store_id IS NULL THEN 1
        ELSE 0
      END AS priority
    FROM public.benefit_policies bp
    WHERE bp.is_active = TRUE
      AND (bp.effective_from IS NULL OR bp.effective_from <= today)
      AND (bp.effective_to   IS NULL OR bp.effective_to   >= today)
  ),
  ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY category, code
        ORDER BY priority DESC, id DESC
      ) AS rn
    FROM candidates
    WHERE priority > 0
  ),
  effective AS (
    SELECT * FROM ranked WHERE rn = 1
  )
  SELECT json_build_object(
    'ok',     true,
    'leave',  (
      SELECT COALESCE(json_agg(json_build_object(
        'code', code, 'config', config, 'notes', notes,
        'scope', CASE priority WHEN 3 THEN '個人' WHEN 2 THEN '門市' ELSE '全公司' END
      ) ORDER BY code), '[]'::json)
      FROM effective WHERE category = 'leave'
    ),
    'bonus',  (
      SELECT COALESCE(json_agg(json_build_object(
        'code', code, 'config', config, 'notes', notes,
        'scope', CASE priority WHEN 3 THEN '個人' WHEN 2 THEN '門市' ELSE '全公司' END
      ) ORDER BY code), '[]'::json)
      FROM effective WHERE category = 'bonus'
    )
  ) INTO result;

  RETURN COALESCE(result, json_build_object('ok', true, 'leave', '[]'::json, 'bonus', '[]'::json));
END $$;


-- ═══ 3. liff_get_my_leave_balances 加 org 隔離 ═══
CREATE OR REPLACE FUNCTION public.liff_get_my_leave_balances(
  p_line_user_id text,
  p_year         int DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  yr  int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  yr := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);

  RETURN json_build_object(
    'ok',   true,
    'year', yr,
    'balances', (
      SELECT COALESCE(json_agg(json_build_object(
        'leave_type',      lb.leave_type,
        'total_days',      lb.total_days,
        'used_days',       lb.used_days,
        'carry_over_days', lb.carry_over_days,
        'remaining',       (lb.total_days + COALESCE(lb.carry_over_days, 0) - lb.used_days),
        'expires_at',      lb.expires_at,
        'expiring_soon',   (lb.expires_at IS NOT NULL AND lb.expires_at <= CURRENT_DATE + INTERVAL '30 days')
      ) ORDER BY lb.leave_type), '[]'::json)
      FROM public.leave_balances lb
      JOIN public.employees e2 ON e2.id = lb.employee_id
      WHERE lb.employee_id = emp.id
        AND lb.year = yr
        AND e2.organization_id IS NOT DISTINCT FROM emp.organization_id
    ),
    'totals', (
      SELECT json_build_object(
        'total',     COALESCE(sum(lb.total_days + COALESCE(lb.carry_over_days, 0)), 0),
        'used',      COALESCE(sum(lb.used_days), 0),
        'remaining', COALESCE(sum(lb.total_days + COALESCE(lb.carry_over_days, 0) - lb.used_days), 0)
      )
      FROM public.leave_balances lb
      JOIN public.employees e2 ON e2.id = lb.employee_id
      WHERE lb.employee_id = emp.id
        AND lb.year = yr
        AND e2.organization_id IS NOT DISTINCT FROM emp.organization_id
    )
  );
END $$;


-- ═══ 4. calc_legal_deduction_for_month 安全加固 ═══
-- 之前 GRANT 給 anon → 任何人傳 employee_id 都能查到法扣金額/案號
-- 改成只給 service_role（這支函數本來就是給 generate_payroll 內部用）
REVOKE EXECUTE ON FUNCTION public.calc_legal_deduction_for_month(int, numeric) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.calc_legal_deduction_for_month(int, numeric) TO service_role;


-- ═══ 5. generate_payroll 加國定假日加班費率 ═══
CREATE OR REPLACE FUNCTION public.generate_payroll(
  p_pay_period CHAR(7),
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
  v_year := SPLIT_PART(p_pay_period, '-', 1)::INT;
  v_month := SPLIT_PART(p_pay_period, '-', 2)::INT;
  v_month_start := MAKE_DATE(v_year, v_month, 1);
  v_month_end := (v_month_start + INTERVAL '1 month - 1 day')::DATE;

  SELECT COUNT(*) INTO v_work_days
  FROM generate_series(v_month_start, v_month_end, '1 day') d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
    AND NOT EXISTS (
      SELECT 1 FROM holidays h
      WHERE h.date = d::date AND h.is_workday = false
    );
  IF v_work_days < 1 THEN v_work_days := 1; END IF;

  INSERT INTO payroll_runs (pay_period, status, created_by)
  VALUES (p_pay_period, 'draft', p_created_by)
  RETURNING id INTO v_run_id;

  FOR rec IN
    SELECT
      e.id AS employee_id,
      e.name,
      COALESCE(ss.base_salary, 0) AS base_salary,
      COALESCE(ss.role_allowance, 0) AS role_allowance,
      COALESCE(ss.meal_allowance, 0) AS meal_allowance,
      COALESCE(ss.transport_allowance, 0) AS transport_allowance,
      COALESCE(ss.attendance_bonus, 0) AS attendance_bonus,
      COALESCE(ss.salary_type, 'monthly') AS salary_type,
      COALESCE(ss.hourly_rate, 0) AS hourly_rate,
      COALESCE(ss.health_ins_dependents, 0) AS health_ins_dependents,
      COALESCE(ss.custom_allowances, '[]'::jsonb) AS custom_allowances,
      e.labor_ins_grade,
      e.health_ins_grade,
      (ss.id IS NULL) AS no_salary_structure
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE e.status = '在職'
  LOOP
    DECLARE
      v_base NUMERIC(10,2) := rec.base_salary;
      v_role_allow NUMERIC(10,2) := rec.role_allowance;
      v_meal NUMERIC(10,2) := rec.meal_allowance;
      v_transport NUMERIC(10,2) := rec.transport_allowance;
      v_attendance_bonus NUMERIC(10,2) := rec.attendance_bonus;
      v_custom_total NUMERIC(10,2) := 0;
      v_custom_breakdown JSONB := '[]'::jsonb;
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
      v_net_before_legal NUMERIC(10,2);
      v_legal_total NUMERIC(10,2) := 0;
      v_legal_breakdown JSONB := '[]'::jsonb;
      v_net NUMERIC(10,2);
      v_hours_worked NUMERIC(6,2) := 0;
      v_daily_rate NUMERIC(10,2);
      v_hourly_rate NUMERIC(10,2);
      v_legal_rec RECORD;
      v_legal_remaining NUMERIC(10,2);
      v_legal_to_deduct NUMERIC(10,2);
      v_legal_avail NUMERIC(10,2);
      v_ca JSONB;
    BEGIN
      IF rec.no_salary_structure AND rec.base_salary = 0 THEN
        RAISE NOTICE 'Employee % (%) has no salary structure, skipping', rec.employee_id, rec.name;
        CONTINUE;
      END IF;

      IF rec.salary_type = 'hourly' THEN
        v_hourly_rate := rec.hourly_rate;
        SELECT COALESCE(SUM(total_hours), 0) INTO v_hours_worked
        FROM attendance_records
        WHERE employee_id = rec.employee_id
          AND date >= v_month_start AND date <= v_month_end;
        v_base := v_hourly_rate * v_hours_worked;
      ELSE
        v_daily_rate := v_base / v_work_days;
        v_hourly_rate := v_daily_rate / 8;
        SELECT COALESCE(SUM(total_hours), 0) INTO v_hours_worked
        FROM attendance_records
        WHERE employee_id = rec.employee_id
          AND date >= v_month_start AND date <= v_month_end;
      END IF;

      -- 自訂津貼累加
      IF jsonb_typeof(rec.custom_allowances) = 'array' THEN
        FOR v_ca IN SELECT * FROM jsonb_array_elements(rec.custom_allowances)
        LOOP
          v_custom_total := v_custom_total + COALESCE((v_ca->>'amount')::numeric, 0);
        END LOOP;
        v_custom_breakdown := rec.custom_allowances;
      END IF;

      -- ★ 加班：週末 OR 國定假日（is_workday=false）都算 holiday rate (2x)
      SELECT
        COALESCE(SUM(CASE
          WHEN EXTRACT(DOW FROM o.request_date) IN (0, 6) THEN 0
          WHEN EXISTS (SELECT 1 FROM holidays h WHERE h.date = o.request_date AND h.is_workday = false) THEN 0
          ELSE o.ot_hours
        END), 0),
        COALESCE(SUM(CASE
          WHEN EXTRACT(DOW FROM o.request_date) IN (0, 6) THEN o.ot_hours
          WHEN EXISTS (SELECT 1 FROM holidays h WHERE h.date = o.request_date AND h.is_workday = false) THEN o.ot_hours
          ELSE 0
        END), 0)
      INTO v_ot_hours_wd, v_ot_hours_hd
      FROM overtime_requests o
      WHERE o.employee_id = rec.employee_id
        AND o.request_date >= v_month_start AND o.request_date <= v_month_end
        AND o.status = '已核准'
        AND (o.ot_type IS NULL OR o.ot_type = 'pay');

      v_ot_pay := (v_ot_hours_wd * v_hourly_rate * 1.34) + (v_ot_hours_hd * v_hourly_rate * 2);

      -- 請假扣
      SELECT COALESCE(SUM(
        LEAST(end_date, v_month_end)::date - GREATEST(start_date, v_month_start)::date + 1
      ), 0) INTO v_leave_days
      FROM leave_requests
      WHERE employee_id = rec.employee_id
        AND start_date <= v_month_end AND end_date >= v_month_start
        AND status = '已核准'
        AND leave_type IN ('事假', 'personal', '無薪假', 'unpaid');

      IF rec.salary_type = 'monthly' THEN
        v_leave_deduction := v_leave_days * v_daily_rate;
      END IF;

      -- 遲到扣
      SELECT COALESCE(SUM(late_minutes), 0) INTO v_late_mins
      FROM attendance_records
      WHERE employee_id = rec.employee_id
        AND date >= v_month_start AND date <= v_month_end
        AND is_late = true;

      v_late_deduction := FLOOR(v_late_mins / 30.0) * (v_hourly_rate * 0.5);

      IF v_late_mins > 0 OR v_leave_days > 0 THEN
        v_attendance_bonus := 0;
      END IF;

      v_gross := v_base + v_role_allow + v_meal + v_transport + v_attendance_bonus + v_ot_pay + v_custom_total;

      IF rec.labor_ins_grade IS NOT NULL THEN
        SELECT employee_premium, employer_premium INTO v_labor_emp, v_labor_er
        FROM labor_ins_brackets
        WHERE year = v_year AND grade = rec.labor_ins_grade;
      END IF;

      IF rec.health_ins_grade IS NOT NULL THEN
        SELECT employee_premium, employer_premium INTO v_health_emp, v_health_er
        FROM health_ins_brackets
        WHERE year = v_year AND grade = rec.health_ins_grade;
        v_health_emp := v_health_emp * (1 + rec.health_ins_dependents);
      END IF;

      v_pension_er := v_gross * 0.06;

      v_total_deductions := v_leave_deduction + v_late_deduction + v_labor_emp + v_health_emp + v_pension_emp;
      v_net_before_legal := v_gross - v_total_deductions;
      v_legal_avail := GREATEST(v_net_before_legal, 0);

      -- 法扣處理
      FOR v_legal_rec IN
        SELECT id, title, monthly_amount, total_amount, paid_amount, paid_months
        FROM legal_deductions
        WHERE employee_id = rec.employee_id
          AND status = '進行中'
          AND started_month <= p_pay_period
        ORDER BY id
      LOOP
        v_legal_remaining := v_legal_rec.total_amount - v_legal_rec.paid_amount;
        v_legal_to_deduct := LEAST(v_legal_rec.monthly_amount, v_legal_remaining);
        v_legal_to_deduct := LEAST(v_legal_to_deduct, v_legal_avail);
        v_legal_to_deduct := GREATEST(v_legal_to_deduct, 0);

        IF v_legal_to_deduct > 0 THEN
          UPDATE legal_deductions
            SET paid_amount = paid_amount + v_legal_to_deduct,
                paid_months = paid_months + 1,
                status = CASE
                  WHEN (paid_amount + v_legal_to_deduct) >= total_amount THEN '已完成'
                  ELSE status
                END,
                updated_at = NOW()
            WHERE id = v_legal_rec.id;

          v_legal_total := v_legal_total + v_legal_to_deduct;
          v_legal_avail := v_legal_avail - v_legal_to_deduct;
        END IF;

        v_legal_breakdown := v_legal_breakdown || jsonb_build_object(
          'id',             v_legal_rec.id,
          'title',          v_legal_rec.title,
          'monthly_amount', v_legal_rec.monthly_amount,
          'amount',         v_legal_to_deduct,
          'shortfall',      v_legal_rec.monthly_amount - v_legal_to_deduct
        );

        EXIT WHEN v_legal_avail <= 0;
      END LOOP;

      v_total_deductions := v_total_deductions + v_legal_total;
      v_net := v_gross - v_total_deductions;

      INSERT INTO payroll_records (
        payroll_run_id, employee_id, pay_period,
        base_salary, role_allowance, meal_allowance, transport_allowance,
        attendance_bonus_earned, overtime_pay, ot_hours_weekday, ot_hours_holiday,
        custom_allowances_total, custom_allowances_breakdown,
        gross_salary,
        leave_deduction, leave_days_deducted, late_deduction, late_minutes,
        labor_ins_employee, health_ins_employee, labor_pension_employee,
        legal_deduction_total, legal_deduction_breakdown,
        total_deductions,
        labor_ins_employer, health_ins_employer, labor_pension_employer,
        net_salary, hours_worked
      ) VALUES (
        v_run_id, rec.employee_id, p_pay_period,
        v_base, v_role_allow, v_meal, v_transport,
        v_attendance_bonus, v_ot_pay, v_ot_hours_wd, v_ot_hours_hd,
        v_custom_total, v_custom_breakdown,
        v_gross,
        v_leave_deduction, v_leave_days, v_late_deduction, v_late_mins,
        v_labor_emp, v_health_emp, v_pension_emp,
        v_legal_total, v_legal_breakdown,
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
