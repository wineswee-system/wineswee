-- =============================================
-- 薪資系統 補強 Phase 3 — 年終獎金結算 function
--
-- 用途：依員工 salary_structures.year_end_bonus_months 計算年終獎金
-- 與 generate_payroll 不同的是：
--   - 不算遲到/請假/加班費等
--   - 只算「底薪 × 月數」
--   - 寫入單獨的 payroll_run（pay_period='2026-13' 表年終）
--   - 也會更新 annual_bonus_tracker 並計算二代健保補充保費
--
-- 呼叫方式：SELECT * FROM generate_year_end_bonus(2026, 1, NULL);
--   p_year: 年度（如 2026）
--   p_months_override: NULL 用結構表預設，數字則覆寫所有員工
-- =============================================

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_year_end_bonus(
  p_year             INTEGER,
  p_months_override  NUMERIC(4,2) DEFAULT NULL,
  p_created_by       INTEGER DEFAULT NULL
)
RETURNS TABLE(payroll_run_id INTEGER, records_created INTEGER, total_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_run_id   INT;
  v_count    INT := 0;
  v_total    NUMERIC(14,2) := 0;
  v_period   CHAR(7);
  rec        RECORD;
BEGIN
  v_period := p_year::TEXT || '-13';  -- 用 -13 表年終獎金

  -- 防呆：同年度不要重複跑
  IF EXISTS (SELECT 1 FROM payroll_runs WHERE pay_period = v_period) THEN
    RAISE EXCEPTION '年度 % 已有年終獎金結算紀錄，如需重跑請先刪除。', p_year;
  END IF;

  INSERT INTO payroll_runs (pay_period, status, created_by)
  VALUES (v_period, 'draft', p_created_by)
  RETURNING id INTO v_run_id;

  FOR rec IN
    SELECT
      e.id                                        AS employee_id,
      e.name,
      e.organization_id,
      COALESCE(ss.base_salary,         0)         AS base_salary,
      COALESCE(p_months_override,
               ss.year_end_bonus_months, 0)       AS bonus_months,
      e.health_ins_grade
    FROM employees e
    LEFT JOIN salary_structures ss ON ss.employee_id = e.id
    WHERE (e.status = '在職'
        OR (e.status = '離職' AND EXTRACT(YEAR FROM e.resign_date) = p_year))
  LOOP
    DECLARE
      v_bonus_amount    NUMERIC(12,2);
      v_income_tax      NUMERIC(10,2) := 0;
      v_nhi_supp        NUMERIC(10,2) := 0;
      v_nhi_breakdown   JSONB         := '[]'::jsonb;
      v_insured_salary  NUMERIC(10,2) := 0;
      v_threshold_4x    NUMERIC(12,2) := 0;
      v_prev_cumul      NUMERIC(12,2) := 0;
      v_new_cumul       NUMERIC(12,2);
      v_taxable         NUMERIC(12,2) := 0;
      v_premium         NUMERIC(10,2) := 0;
      v_record_id       INT;
      v_total_deductions NUMERIC(10,2);
      v_net             NUMERIC(10,2);
    BEGIN
      v_bonus_amount := ROUND(rec.base_salary * rec.bonus_months);

      IF v_bonus_amount <= 0 THEN CONTINUE; END IF;

      -- 二代健保：年度累計超 4 倍
      IF rec.health_ins_grade IS NOT NULL THEN
        SELECT insured_salary INTO v_insured_salary
        FROM health_ins_brackets
        WHERE year = p_year AND grade = rec.health_ins_grade;

        IF v_insured_salary IS NOT NULL AND v_insured_salary > 0 THEN
          v_threshold_4x := v_insured_salary * 4;

          SELECT cumulative_bonus INTO v_prev_cumul
            FROM annual_bonus_tracker
           WHERE employee_id = rec.employee_id AND year = p_year;
          v_prev_cumul := COALESCE(v_prev_cumul, 0);
          v_new_cumul  := v_prev_cumul + v_bonus_amount;

          IF v_new_cumul > v_threshold_4x AND v_prev_cumul < v_threshold_4x THEN
            v_taxable := v_new_cumul - v_threshold_4x;
          ELSIF v_prev_cumul >= v_threshold_4x THEN
            v_taxable := v_bonus_amount;
          END IF;

          IF v_taxable > 0 THEN
            v_premium := ROUND(v_taxable * 0.0211);
            v_nhi_supp := v_premium;
            v_nhi_breakdown := jsonb_build_array(jsonb_build_object(
              'category', '年終獎金累計',
              'income', v_bonus_amount,
              'cumulative', v_new_cumul,
              'threshold_4x', v_threshold_4x,
              'taxable', v_taxable,
              'rate', 0.0211,
              'premium', v_premium
            ));
          END IF;

          INSERT INTO annual_bonus_tracker (
            employee_id, year, organization_id,
            cumulative_bonus, insured_salary, threshold,
            exceeded_at
          ) VALUES (
            rec.employee_id, p_year, rec.organization_id,
            v_new_cumul, v_insured_salary, v_threshold_4x,
            CASE WHEN v_new_cumul > v_threshold_4x THEN NOW() ELSE NULL END
          )
          ON CONFLICT (employee_id, year) DO UPDATE SET
            cumulative_bonus = EXCLUDED.cumulative_bonus,
            insured_salary   = EXCLUDED.insured_salary,
            threshold        = EXCLUDED.threshold,
            exceeded_at      = COALESCE(annual_bonus_tracker.exceeded_at, EXCLUDED.exceeded_at),
            updated_at       = NOW();
        END IF;
      END IF;

      -- 所得稅扣繳（依年終獎金級距）
      v_income_tax := public._calc_monthly_withholding(v_bonus_amount);

      v_total_deductions := v_income_tax + v_nhi_supp;
      v_net := v_bonus_amount - v_total_deductions;

      INSERT INTO payroll_records (
        payroll_run_id, employee_id, pay_period,
        year_end_bonus, gross_salary,
        income_tax_withheld,
        nhi_supplementary, nhi_supplementary_breakdown,
        total_deductions, net_salary,
        is_final_settlement
      ) VALUES (
        v_run_id, rec.employee_id, v_period,
        v_bonus_amount, v_bonus_amount,
        v_income_tax,
        v_nhi_supp, v_nhi_breakdown,
        v_total_deductions, v_net,
        false
      ) RETURNING id INTO v_record_id;

      IF v_nhi_supp > 0 THEN
        INSERT INTO nhi_supplementary_records (
          payroll_record_id, employee_id, pay_period, organization_id,
          income_category, income_amount, exempt_amount, taxable_amount,
          rate, premium_amount
        ) VALUES (
          v_record_id, rec.employee_id, v_period, rec.organization_id,
          '高額獎金', v_bonus_amount, v_bonus_amount - v_taxable, v_taxable,
          0.0211, v_premium
        );
      END IF;

      v_count := v_count + 1;
      v_total := v_total + v_bonus_amount;
    END;
  END LOOP;

  payroll_run_id  := v_run_id;
  records_created := v_count;
  total_amount    := v_total;
  RETURN NEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_year_end_bonus(INTEGER, NUMERIC, INTEGER) TO authenticated;

COMMIT;
