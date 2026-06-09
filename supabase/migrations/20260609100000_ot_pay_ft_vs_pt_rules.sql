-- ════════════════════════════════════════════════════════════════════════════
-- 加班費倍率新規則 — 正職 vs 兼職分流
--
-- 用戶決策：
--   - 正職（FT, salary_type='monthly'）國定假日加班 → 用平日倍率（1.34/1.67）
--     理由：FT 月薪已含國定假日的工資，OT 那部分就是普通加班
--   - 正職例假加班 → ×2 全程 + 強制自動建補休 ledger（時數 = OT 時數）
--     理由：§39 例假加倍給付 + 補假 1 天
--   - 兼職（PT, hourly）一切照舊（含國定假日 ×2、例假 ×2）
--   - 平日 / 休息日：FT 跟 PT 都一樣（不動）
--
-- 變動：
--   1. _compute_ot_pay 加 p_salary_type 參數，holiday 依 FT/PT 分流
--   2. generate_payroll OT 計算改用 ot_category 分桶（之前用 DOW 兩桶合併）
--   3. 新 trigger trg_force_ot_type_for_weekly_off_ft：FT 例假 OT 強制
--      ot_type='pay'（避免員工選 comp_time 後不發加倍給付）
--   4. trg_create_comp_time_ledger 擴充：FT 例假 OT 核准時自動建 ledger
--      （凍結金額 = hours × hourly，純時間補；過期兌現用原領工資）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. _compute_ot_pay 加 salary_type 參數 ──────────────────────────────
CREATE OR REPLACE FUNCTION public._compute_ot_pay(
  p_hours        NUMERIC,
  p_hourly_rate  NUMERIC,
  p_category     TEXT,
  p_salary_type  TEXT DEFAULT 'monthly'
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_is_ft BOOLEAN := (COALESCE(p_salary_type, 'monthly') = 'monthly');
BEGIN
  IF p_hours IS NULL OR p_hours <= 0 OR p_hourly_rate IS NULL OR p_hourly_rate <= 0 THEN
    RETURN 0;
  END IF;

  -- 平日：FT/PT 一樣
  IF p_category = 'weekday' THEN
    RETURN CEIL(
      LEAST(p_hours, 2) * p_hourly_rate * 1.34
      + GREATEST(p_hours - 2, 0) * p_hourly_rate * 1.67
    );
  END IF;

  -- 國定假日：FT 用平日倍率（月薪已含此日工資）/ PT 用 ×2 全程
  IF p_category = 'holiday' THEN
    IF v_is_ft THEN
      RETURN CEIL(
        LEAST(p_hours, 2) * p_hourly_rate * 1.34
        + GREATEST(p_hours - 2, 0) * p_hourly_rate * 1.67
      );
    ELSE
      RETURN CEIL(p_hours * p_hourly_rate * 2.0);
    END IF;
  END IF;

  -- 例假：FT/PT 都 ×2 全程
  IF p_category = 'weekly_off' THEN
    RETURN CEIL(p_hours * p_hourly_rate * 2.0);
  END IF;

  -- 休息日（restday）：FT/PT 都用階梯 1.34/1.67/2.67
  RETURN CEIL(
    LEAST(p_hours, 2) * p_hourly_rate * 1.34
    + LEAST(GREATEST(p_hours - 2, 0), 6) * p_hourly_rate * 1.67
    + GREATEST(p_hours - 8, 0) * p_hourly_rate * 2.67
  );
END $$;


-- ─── 2. generate_payroll OT 計算改用 ot_category 分桶 ──────────────────
-- 之前是 DOW 兩桶（weekday vs DOW 0/6），現在 4 桶並用 _compute_ot_pay
CREATE OR REPLACE FUNCTION public.generate_payroll(
  p_pay_period CHARACTER,
  p_created_by INTEGER DEFAULT NULL::INTEGER
)
RETURNS TABLE(payroll_run_id INTEGER, records_created INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_run_id      INT;
  v_count       INT := 0;
  v_year        INT;
  v_month       INT;
  v_month_start DATE;
  v_month_end   DATE;
  v_work_days   INT;
  rec           RECORD;
BEGIN
  v_year        := SPLIT_PART(p_pay_period, '-', 1)::INT;
  v_month       := SPLIT_PART(p_pay_period, '-', 2)::INT;
  v_month_start := MAKE_DATE(v_year, v_month, 1);
  v_month_end   := (v_month_start + INTERVAL '1 month - 1 day')::DATE;

  v_work_days := (v_month_end - v_month_start + 1)::INT;
  IF v_work_days < 1 THEN v_work_days := 1; END IF;

  INSERT INTO payroll_runs (pay_period, status, created_by)
  VALUES (p_pay_period, 'draft', p_created_by)
  RETURNING id INTO v_run_id;

  FOR rec IN
    SELECT
      e.id                                        AS employee_id,
      e.name,
      e.status,
      e.join_date,
      e.resign_date,
      e.organization_id,
      COALESCE(ss.base_salary,          0)        AS base_salary,
      COALESCE(ss.role_allowance,       0)        AS role_allowance,
      COALESCE(ss.meal_allowance,       0)        AS meal_allowance,
      COALESCE(ss.transport_allowance,  0)        AS transport_allowance,
      COALESCE(ss.attendance_bonus,     0)        AS attendance_bonus,
      COALESCE(ss.salary_type, 'monthly')         AS salary_type,
      COALESCE(ss.hourly_rate,          0)        AS hourly_rate,
      COALESCE(ss.health_ins_dependents,0)        AS health_ins_dependents,
      COALESCE(ss.custom_allowances, '[]'::jsonb) AS custom_allowances,
      e.labor_ins_grade,
      e.health_ins_grade,
      COALESCE(e.labor_insurance, false)          AS labor_insurance_enrolled,
      COALESCE(e.health_insurance, false)         AS health_insurance_enrolled,
      COALESCE(e.labor_pension_self_rate, 0)      AS pension_self_rate,
      (ss.id IS NULL)                             AS no_salary_structure
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE (e.join_date IS NULL OR e.join_date <= v_month_end)
      AND (
        e.status = '在職'
        OR (e.status = '離職'
            AND e.resign_date IS NOT NULL
            AND e.resign_date >= v_month_start
            AND e.resign_date <= v_month_end)
      )
  LOOP
    DECLARE
      v_base             NUMERIC(10,2) := rec.base_salary;
      v_role_allow       NUMERIC(10,2) := rec.role_allowance;
      v_meal             NUMERIC(10,2) := rec.meal_allowance;
      v_transport        NUMERIC(10,2) := rec.transport_allowance;
      v_attendance_bonus NUMERIC(10,2) := rec.attendance_bonus;
      v_custom_total     NUMERIC(10,2) := 0;
      v_custom_breakdown JSONB         := '[]'::jsonb;

      -- 4 桶分類
      v_ot_hours_wd  NUMERIC(5,2)  := 0;  -- weekday
      v_ot_hours_rd  NUMERIC(5,2)  := 0;  -- restday
      v_ot_hours_wo  NUMERIC(5,2)  := 0;  -- weekly_off
      v_ot_hours_ho  NUMERIC(5,2)  := 0;  -- holiday
      v_ot_pay       NUMERIC(10,2) := 0;
      v_comp_settled NUMERIC(10,2) := 0;

      v_swap_hd_hours NUMERIC(5,2) := 0;

      v_gross         NUMERIC(10,2);
      v_income_tax    NUMERIC(10,2) := 0;

      v_leave_deduction NUMERIC(10,2) := 0;
      v_leave_days      NUMERIC(4,1)  := 0;
      v_unpaid_days     NUMERIC(4,1)  := 0;
      v_unpaid_hours    NUMERIC(5,2)  := 0;
      v_half_days       NUMERIC(4,1)  := 0;
      v_half_hours      NUMERIC(5,2)  := 0;
      v_late_deduction  NUMERIC(10,2) := 0;
      v_late_mins       INT           := 0;

      v_labor_emp  NUMERIC(10,2) := 0;
      v_labor_er   NUMERIC(10,2) := 0;
      v_health_emp NUMERIC(10,2) := 0;
      v_health_er  NUMERIC(10,2) := 0;
      v_pension_emp NUMERIC(10,2) := 0;
      v_pension_er  NUMERIC(10,2) := 0;

      v_nhi_supp        NUMERIC(10,2) := 0;
      v_nhi_breakdown   JSONB         := '[]'::jsonb;
      v_insured_salary  NUMERIC(10,2) := 0;
      v_nhi_threshold   NUMERIC(12,2) := 0;

      v_unused_leave_days   NUMERIC(5,1) := 0;
      v_unused_leave_payout NUMERIC(10,2) := 0;
      v_is_final_settlement BOOLEAN := false;

      v_total_deductions NUMERIC(10,2);
      v_net_before_legal NUMERIC(10,2);
      v_legal_total      NUMERIC(10,2) := 0;
      v_legal_breakdown  JSONB         := '[]'::jsonb;
      v_net              NUMERIC(10,2);
      v_hours_worked     NUMERIC(6,2)  := 0;

      v_daily_rate  NUMERIC(10,2);
      v_hourly_rate NUMERIC(10,2);
      v_legal_rec   RECORD;
      v_legal_remaining NUMERIC(10,2);
      v_legal_to_deduct NUMERIC(10,2);
      v_legal_avail     NUMERIC(10,2);
      v_ca  JSONB;
      v_record_id INT;

      v_effective_start  DATE;
      v_effective_end    DATE;
      v_actual_work_days INT          := 0;
      v_prorate_ratio    NUMERIC(6,4) := 1;
    BEGIN
      IF rec.no_salary_structure AND rec.base_salary = 0 THEN
        RAISE NOTICE 'Employee % (%) has no salary structure, skipping', rec.employee_id, rec.name;
        CONTINUE;
      END IF;

      v_is_final_settlement := (rec.status = '離職');

      SELECT COALESCE(SUM(total_hours), 0) INTO v_hours_worked
      FROM attendance_records
      WHERE employee_id = rec.employee_id
        AND date >= v_month_start AND date <= v_month_end;

      IF rec.salary_type = 'hourly' THEN
        v_hourly_rate      := rec.hourly_rate;
        v_base             := v_hourly_rate * v_hours_worked;
        v_daily_rate       := v_hourly_rate * 8;
        v_actual_work_days := v_work_days;
        v_prorate_ratio    := 1;
      ELSE
        v_daily_rate  := rec.base_salary / v_work_days;
        v_hourly_rate := v_daily_rate / 8;

        v_effective_start := GREATEST(COALESCE(rec.join_date, v_month_start), v_month_start);
        v_effective_end   := CASE
          WHEN rec.resign_date IS NOT NULL AND rec.resign_date <= v_month_end
          THEN rec.resign_date
          ELSE v_month_end
        END;

        IF v_effective_start > v_month_start OR v_effective_end < v_month_end THEN
          v_actual_work_days := (v_effective_end - v_effective_start + 1)::INT;
          IF v_actual_work_days < 1 THEN v_actual_work_days := 1; END IF;

          v_prorate_ratio := v_actual_work_days::NUMERIC / NULLIF(v_work_days, 0)::NUMERIC;

          v_base             := CEIL(rec.base_salary           * v_prorate_ratio);
          v_role_allow       := CEIL(rec.role_allowance        * v_prorate_ratio);
          v_meal             := CEIL(rec.meal_allowance        * v_prorate_ratio);
          v_transport        := CEIL(rec.transport_allowance   * v_prorate_ratio);
          v_attendance_bonus := CEIL(rec.attendance_bonus      * v_prorate_ratio);
        ELSE
          v_actual_work_days := v_work_days;
          v_prorate_ratio    := 1;
        END IF;
      END IF;

      IF jsonb_typeof(rec.custom_allowances) = 'array' THEN
        FOR v_ca IN SELECT * FROM jsonb_array_elements(rec.custom_allowances)
        LOOP
          v_custom_total := v_custom_total + COALESCE((v_ca->>'amount')::numeric, 0);
        END LOOP;
        v_custom_breakdown := rec.custom_allowances;
      END IF;
      IF rec.salary_type = 'monthly' AND v_prorate_ratio < 1 THEN
        v_custom_total := CEIL(v_custom_total * v_prorate_ratio);
      END IF;

      -- ── Overtime（依 ot_category 4 桶分類）──
      SELECT
        COALESCE(SUM(CASE WHEN ot_category = 'weekday'    THEN ot_hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ot_category = 'restday'    THEN ot_hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ot_category = 'weekly_off' THEN ot_hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ot_category = 'holiday'    THEN ot_hours ELSE 0 END), 0)
      INTO v_ot_hours_wd, v_ot_hours_rd, v_ot_hours_wo, v_ot_hours_ho
      FROM overtime_requests
      WHERE employee_id = rec.employee_id
        AND request_date >= v_month_start AND request_date <= v_month_end
        AND status = '已核准'
        AND (ot_type IS NULL OR ot_type = 'pay');

      -- shift_swap 換班落在休息/例假/國定假日 → 補進 restday 桶（保守處理）
      SELECT COALESCE(SUM(ar.total_hours), 0)
        INTO v_swap_hd_hours
        FROM attendance_records ar
       WHERE ar.employee_id = rec.employee_id
         AND ar.date >= v_month_start AND ar.date <= v_month_end
         AND ar.clock_in_mode = 'shift_swap'
         AND (
           EXTRACT(DOW FROM ar.date) IN (0, 6)
           OR EXISTS (
             SELECT 1 FROM holidays h
             WHERE h.date = ar.date AND h.is_workday = false
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM overtime_requests ot
            WHERE ot.employee_id = rec.employee_id
              AND ot.request_date = ar.date
              AND ot.status = '已核准'
         );

      v_ot_hours_rd := v_ot_hours_rd + COALESCE(v_swap_hd_hours, 0);

      -- 4 桶分開算 OT pay（依 salary_type 走 FT/PT 規則）
      v_ot_pay :=
          public._compute_ot_pay(v_ot_hours_wd, v_hourly_rate, 'weekday',    rec.salary_type)
        + public._compute_ot_pay(v_ot_hours_rd, v_hourly_rate, 'restday',    rec.salary_type)
        + public._compute_ot_pay(v_ot_hours_wo, v_hourly_rate, 'weekly_off', rec.salary_type)
        + public._compute_ot_pay(v_ot_hours_ho, v_hourly_rate, 'holiday',    rec.salary_type);

      -- ── 過期補休自動兌現 ──
      v_comp_settled := COALESCE(
        public._settle_expired_comp_time(rec.employee_id, v_run_id, v_month_end),
        0
      );
      v_ot_pay := v_ot_pay + v_comp_settled;

      -- ── Leave deduction ──
      SELECT
        COALESCE(SUM(CASE
          WHEN COALESCE(unit, 'day') = 'hour' THEN 0
          ELSE LEAST(end_date, v_month_end)::date - GREATEST(start_date, v_month_start)::date + 1
        END), 0),
        COALESCE(SUM(CASE
          WHEN COALESCE(unit, 'day') = 'hour' THEN COALESCE(hours, 0)
          ELSE 0
        END), 0)
      INTO v_unpaid_days, v_unpaid_hours
      FROM leave_requests
      WHERE employee_id = rec.employee_id
        AND start_date <= v_month_end AND end_date >= v_month_start
        AND status = '已核准'
        AND type IN ('事假', '事', 'personal', '無薪假', 'unpaid');

      SELECT
        COALESCE(SUM(CASE
          WHEN COALESCE(unit, 'day') = 'hour' THEN 0
          ELSE LEAST(end_date, v_month_end)::date - GREATEST(start_date, v_month_start)::date + 1
        END), 0),
        COALESCE(SUM(CASE
          WHEN COALESCE(unit, 'day') = 'hour' THEN COALESCE(hours, 0)
          ELSE 0
        END), 0)
      INTO v_half_days, v_half_hours
      FROM leave_requests
      WHERE employee_id = rec.employee_id
        AND start_date <= v_month_end AND end_date >= v_month_start
        AND status = '已核准'
        AND type IN ('病假', '病', 'sick', '生理假', '生', 'menstrual');

      v_leave_days := v_unpaid_days + v_half_days
                    + (v_unpaid_hours + v_half_hours) / 8.0;

      IF rec.salary_type = 'monthly' THEN
        v_leave_deduction := FLOOR(
          (v_unpaid_days  * v_daily_rate)
          + (v_unpaid_hours * v_hourly_rate)
          + (v_half_days  * v_daily_rate * 0.5)
          + (v_half_hours * v_hourly_rate * 0.5)
        );
      END IF;

      SELECT COALESCE(SUM(late_minutes), 0) INTO v_late_mins
      FROM attendance_records
      WHERE employee_id = rec.employee_id
        AND date >= v_month_start AND date <= v_month_end
        AND is_late = true
        AND COALESCE(clock_in_mode, 'normal') = 'normal';

      v_late_deduction := FLOOR(FLOOR(v_late_mins / 30.0) * v_hourly_rate * 0.5);

      IF v_late_mins > 0 OR v_leave_days > 0 THEN
        v_attendance_bonus := 0;
      END IF;

      -- ── 離職結算未休特休折現 ──
      IF v_is_final_settlement THEN
        SELECT COALESCE(SUM(GREATEST(total_days + carry_over_days - used_days, 0)), 0)
          INTO v_unused_leave_days
        FROM leave_balances
        WHERE employee_id = rec.employee_id
          AND year = v_year
          AND leave_type IN ('特休', 'annual', '特別休假');

        IF rec.salary_type = 'monthly' THEN
          v_unused_leave_payout := CEIL(v_unused_leave_days * (rec.base_salary / v_work_days));
        ELSE
          v_unused_leave_payout := CEIL(v_unused_leave_days * v_hourly_rate * 8);
        END IF;
      END IF;

      v_gross := v_base + v_role_allow + v_meal + v_transport
               + v_attendance_bonus + v_ot_pay + v_custom_total
               + v_unused_leave_payout;

      -- ── 二代健保補充保費 ──
      IF rec.health_ins_grade IS NOT NULL THEN
        SELECT insured_salary INTO v_insured_salary
        FROM health_ins_brackets
        WHERE year = v_year AND grade = rec.health_ins_grade;

        v_nhi_threshold := COALESCE(v_insured_salary, 0);

        IF v_ot_pay > v_nhi_threshold AND v_nhi_threshold > 0 THEN
          DECLARE
            v_ot_excess  NUMERIC(12,2) := v_ot_pay - v_nhi_threshold;
            v_ot_premium NUMERIC(10,2) := FLOOR(v_ot_excess * 0.0211);
          BEGIN
            v_nhi_supp := v_nhi_supp + v_ot_premium;
            v_nhi_breakdown := v_nhi_breakdown || jsonb_build_object(
              'category', '加班費超額',
              'income', v_ot_pay,
              'exempt', v_nhi_threshold,
              'taxable', v_ot_excess,
              'rate', 0.0211,
              'premium', v_ot_premium
            );
          END;
        END IF;

        IF v_nhi_threshold > 0 THEN
          DECLARE
            v_bonus_this_month   NUMERIC(12,2) := 0;
            v_threshold_4x       NUMERIC(12,2) := v_nhi_threshold * 4;
            v_prev_cumul         NUMERIC(12,2) := 0;
            v_new_cumul          NUMERIC(12,2);
            v_taxable_this_month NUMERIC(12,2) := 0;
            v_bonus_premium      NUMERIC(10,2);
          BEGIN
            v_bonus_this_month := v_attendance_bonus;

            IF v_bonus_this_month > 0 THEN
              SELECT cumulative_bonus INTO v_prev_cumul
                FROM annual_bonus_tracker
               WHERE employee_id = rec.employee_id AND year = v_year;
              v_prev_cumul := COALESCE(v_prev_cumul, 0);
              v_new_cumul  := v_prev_cumul + v_bonus_this_month;

              IF v_new_cumul > v_threshold_4x AND v_prev_cumul < v_threshold_4x THEN
                v_taxable_this_month := v_new_cumul - v_threshold_4x;
              ELSIF v_prev_cumul >= v_threshold_4x THEN
                v_taxable_this_month := v_bonus_this_month;
              END IF;

              IF v_taxable_this_month > 0 THEN
                v_bonus_premium := FLOOR(v_taxable_this_month * 0.0211);
                v_nhi_supp := v_nhi_supp + v_bonus_premium;
                v_nhi_breakdown := v_nhi_breakdown || jsonb_build_object(
                  'category', '高額獎金累計',
                  'income', v_bonus_this_month,
                  'cumulative', v_new_cumul,
                  'threshold_4x', v_threshold_4x,
                  'taxable', v_taxable_this_month,
                  'rate', 0.0211,
                  'premium', v_bonus_premium
                );
              END IF;

              INSERT INTO annual_bonus_tracker (
                employee_id, year, organization_id,
                cumulative_bonus, insured_salary, threshold,
                exceeded_at
              ) VALUES (
                rec.employee_id, v_year, rec.organization_id,
                v_new_cumul, v_nhi_threshold, v_threshold_4x,
                CASE WHEN v_new_cumul > v_threshold_4x THEN NOW() ELSE NULL END
              )
              ON CONFLICT (employee_id, year) DO UPDATE SET
                cumulative_bonus = EXCLUDED.cumulative_bonus,
                insured_salary   = EXCLUDED.insured_salary,
                threshold        = EXCLUDED.threshold,
                exceeded_at      = COALESCE(annual_bonus_tracker.exceeded_at, EXCLUDED.exceeded_at),
                updated_at       = NOW();
            END IF;
          END;
        END IF;
      END IF;

      v_income_tax := public._calc_monthly_withholding(v_gross);

      -- ── Insurance（toggle + 動態級距）──
      DECLARE
        v_base_for_insure NUMERIC(10,2) :=
          v_base + v_role_allow + v_meal + v_transport + v_attendance_bonus + v_custom_total;
      BEGIN
        -- 勞保
        IF NOT rec.labor_insurance_enrolled THEN
          v_labor_emp := 0; v_labor_er := 0;
        ELSIF rec.labor_ins_grade IS NOT NULL THEN
          SELECT employee_premium, employer_premium INTO v_labor_emp, v_labor_er
          FROM labor_ins_brackets
          WHERE year = v_year AND grade = rec.labor_ins_grade;
        ELSE
          SELECT employee_premium, employer_premium INTO v_labor_emp, v_labor_er
          FROM labor_ins_brackets
          WHERE year = v_year AND insured_salary >= v_base_for_insure
          ORDER BY insured_salary ASC LIMIT 1;
          IF v_labor_emp IS NULL THEN
            SELECT employee_premium, employer_premium INTO v_labor_emp, v_labor_er
            FROM labor_ins_brackets
            WHERE year = v_year
            ORDER BY insured_salary DESC LIMIT 1;
          END IF;
        END IF;

        -- 健保
        IF NOT rec.health_insurance_enrolled THEN
          v_health_emp := 0; v_health_er := 0;
        ELSIF rec.health_ins_grade IS NOT NULL THEN
          SELECT employee_premium, employer_premium INTO v_health_emp, v_health_er
          FROM health_ins_brackets
          WHERE year = v_year AND grade = rec.health_ins_grade;
          v_health_emp := v_health_emp * (1 + rec.health_ins_dependents);
        ELSE
          SELECT employee_premium, employer_premium INTO v_health_emp, v_health_er
          FROM health_ins_brackets
          WHERE year = v_year AND insured_salary >= v_base_for_insure
          ORDER BY insured_salary ASC LIMIT 1;
          IF v_health_emp IS NULL THEN
            SELECT employee_premium, employer_premium INTO v_health_emp, v_health_er
            FROM health_ins_brackets
            WHERE year = v_year
            ORDER BY insured_salary DESC LIMIT 1;
          END IF;
          v_health_emp := v_health_emp * (1 + rec.health_ins_dependents);
        END IF;
      END;

      v_pension_er  := CEIL(LEAST(v_base, 150000) * 0.06);
      v_pension_emp := FLOOR(LEAST(v_base, 150000) * (rec.pension_self_rate / 100.0));

      v_total_deductions := v_leave_deduction + v_late_deduction
                          + v_labor_emp + v_health_emp + v_pension_emp
                          + v_income_tax + v_nhi_supp;

      v_net_before_legal := v_gross - v_total_deductions;
      v_legal_avail      := GREATEST(v_net_before_legal, 0);

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
                 status      = CASE
                                 WHEN (paid_amount + v_legal_to_deduct) >= total_amount THEN '已完成'
                                 ELSE status
                               END,
                 updated_at  = NOW()
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
      v_net              := CEIL(v_gross - v_total_deductions);

      -- ── Insert payroll_record ──
      -- ot_hours_weekday = weekday；ot_hours_holiday = restday + weekly_off + holiday 合併（顯示用）
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
        v_base, v_role_allow, v_meal, v_transport,
        v_attendance_bonus, v_ot_pay, v_ot_hours_wd, (v_ot_hours_rd + v_ot_hours_wo + v_ot_hours_ho),
        v_custom_total, v_custom_breakdown,
        v_gross,
        v_income_tax,
        v_leave_deduction, v_leave_days, v_late_deduction, v_late_mins,
        v_labor_emp, v_health_emp, v_pension_emp,
        v_nhi_supp, v_nhi_breakdown,
        v_unused_leave_payout, v_unused_leave_days, v_is_final_settlement,
        v_legal_total, v_legal_breakdown,
        v_total_deductions,
        v_labor_er, v_health_er, v_pension_er,
        v_net, v_hours_worked,
        v_prorate_ratio, v_actual_work_days
      ) RETURNING id INTO v_record_id;

      IF v_nhi_supp > 0 THEN
        INSERT INTO nhi_supplementary_records (
          payroll_record_id, employee_id, pay_period, organization_id,
          income_category, income_amount, exempt_amount, taxable_amount,
          rate, premium_amount
        )
        SELECT
          v_record_id, rec.employee_id, p_pay_period, rec.organization_id,
          (item->>'category'),
          (item->>'income')::numeric,
          COALESCE((item->>'exempt')::numeric, 0),
          (item->>'taxable')::numeric,
          (item->>'rate')::numeric,
          (item->>'premium')::numeric
        FROM jsonb_array_elements(v_nhi_breakdown) AS item
        WHERE (item->>'premium')::numeric > 0;
      END IF;

      v_count := v_count + 1;
    END;
  END LOOP;

  payroll_run_id  := v_run_id;
  records_created := v_count;
  RETURN NEXT;
END;
$function$;


-- ─── 3. 新 trigger：FT 例假 OT 強制 ot_type='pay' ────────────────────────
CREATE OR REPLACE FUNCTION public.trg_force_ot_type_for_weekly_off_ft()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_ft BOOLEAN;
  v_category TEXT;
BEGIN
  v_category := COALESCE(
    NEW.ot_category,
    public.classify_overtime_category_v2(COALESCE(NEW.request_date, NEW.date), NEW.employee_id)
  );

  IF v_category = 'weekly_off' THEN
    SELECT (ss.salary_type = 'monthly') INTO v_is_ft
      FROM salary_structures ss WHERE ss.employee_id = NEW.employee_id LIMIT 1;
    IF COALESCE(v_is_ft, false) THEN
      NEW.ot_type := 'pay';  -- 強制 pay（保證加倍給付，避免員工誤選 comp_time）
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_force_ot_type_weekly_off_ft ON public.overtime_requests;
CREATE TRIGGER trg_force_ot_type_weekly_off_ft
  BEFORE INSERT OR UPDATE OF ot_type, ot_category, employee_id ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_force_ot_type_for_weekly_off_ft();


-- ─── 4. 擴充 trg_create_comp_time_ledger：FT 例假 OT 核准時自動建 ledger ─
CREATE OR REPLACE FUNCTION public.trg_create_comp_time_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hours        NUMERIC;
  v_date         DATE;
  v_base         NUMERIC;
  v_hourly_rate  NUMERIC;
  v_amount       NUMERIC;
  v_org_id       INT;
  v_category     TEXT;
  v_is_ft        BOOLEAN := false;
  v_salary_type  TEXT := 'monthly';
  v_is_weekly_off_ft BOOLEAN := false;
  v_should_create BOOLEAN := false;
BEGIN
  IF NEW.status <> '已核准' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = '已核准' THEN
    RETURN NEW;
  END IF;

  v_hours := COALESCE(NEW.ot_hours, NEW.hours);
  v_date  := COALESCE(NEW.request_date, NEW.date);
  IF v_hours IS NULL OR v_hours <= 0 OR v_date IS NULL THEN
    RETURN NEW;
  END IF;

  v_category := COALESCE(
    NEW.ot_category,
    public.classify_overtime_category_v2(v_date, NEW.employee_id)
  );

  SELECT COALESCE(ss.base_salary, 0), COALESCE(ss.salary_type, 'monthly'), e.organization_id
    INTO v_base, v_salary_type, v_org_id
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
   WHERE e.id = NEW.employee_id;

  v_is_ft := (v_salary_type = 'monthly');
  v_is_weekly_off_ft := (v_is_ft AND v_category = 'weekly_off');

  -- 觸發條件：
  --   (1) 員工選 comp_time（原有邏輯）
  --   (2) FT 例假 OT（新：強制補休，無論 ot_type）
  IF COALESCE(NEW.ot_type, 'pay') = 'comp_time' OR v_is_weekly_off_ft THEN
    v_should_create := true;
  END IF;

  IF NOT v_should_create THEN
    RETURN NEW;
  END IF;

  IF v_base IS NULL OR v_base <= 0 THEN
    RAISE NOTICE 'comp_time ledger skipped: employee % has no base_salary', NEW.employee_id;
    RETURN NEW;
  END IF;

  v_hourly_rate := ROUND(v_base / 30.0 / 8.0, 2);

  -- 凍結金額：
  --   FT 例假強制補休 → hours × hourly（純時間補，過期兌現用原領工資）
  --   一般 comp_time → 依 _compute_ot_pay（按 category 倍率）
  IF v_is_weekly_off_ft THEN
    v_amount := CEIL(v_hours * v_hourly_rate);
  ELSE
    v_amount := public._compute_ot_pay(v_hours, v_hourly_rate, v_category, v_salary_type);
  END IF;

  INSERT INTO public.comp_time_ledger (
    employee_id, overtime_request_id, organization_id,
    hours, ot_date, expires_at,
    frozen_hourly_rate, frozen_ot_amount,
    status
  ) VALUES (
    NEW.employee_id, NEW.id, COALESCE(v_org_id, NEW.organization_id),
    v_hours, v_date, v_date + INTERVAL '1 year' - INTERVAL '1 day',
    v_hourly_rate, v_amount,
    'active'
  )
  ON CONFLICT (overtime_request_id) DO NOTHING;

  RETURN NEW;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
