-- ════════════════════════════════════════════════════════════════════════════
-- preview_payroll：批次計薪「試算」聚合 RPC（階段 A — 把前端引擎搬進 DB）
-- 2026-06-15
--
-- 目的：批次計薪預覽目前在前端 payrollCalc.js + payroll.js 算（85 員工 N+1 query
--   + 瀏覽器運算）。本 RPC 把計算搬到後端，一次回每位員工試算明細 → 更快 + 單一真相源。
--
-- ★ 純讀、不寫任何表、無副作用（與 generate_payroll 的結算副作用完全隔離）。
-- ★ 算法 1:1 對齊「前端 computeBatchPayroll」（src/lib/payrollCalc.js + payroll.js）。
--   切換前用 scripts/_diff_preview_payroll.mjs 逐人逐欄比對到完全一致才切前端。
--
-- 對齊基準（記憶 project_engineering_hardening_2026_06_15「逐項定案」）：
--   加班費 / 勞健保(覈實 cap45800·PT11100) / 請假遲到((base+津貼)/30/8+店容忍) / 所得稅不代扣
--   → 全部以「前端」為準（本 RPC 即實作前端算法）。
--   二代健保補充保費 / 法定百分比扣款 → 前端 batch 預覽本來就沒算，本 RPC 也比照不算。
--
-- 階段 B（之後）：generate_payroll 改共用本檔的 _compute_payroll_for_employee，
--   達成「試算=入帳」。本檔不碰 generate_payroll。
--
-- idempotent：CREATE OR REPLACE，無破壞性 DDL。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- helper：單日單類別加班費（對齊 payrollCalc.js calcOtPay 的 per-day 算法）
--   weekday/restday/holiday 走「每日」階梯（§32 每日重設）；weekly_off 用總時數呼叫一次
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ot_pay_zh(
  p_hours     numeric,
  p_hourly    numeric,
  p_category  text,
  p_is_hourly boolean
) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_category
    WHEN 'weekday' THEN
      CASE WHEN p_hours <= 2 THEN ceil(p_hours * p_hourly * 1.34)
           ELSE ceil(2 * p_hourly * 1.34 + (p_hours - 2) * p_hourly * 1.67) END
    WHEN 'restday' THEN
      ceil(least(p_hours, 2) * p_hourly * 1.34
         + least(greatest(p_hours - 2, 0), 6) * p_hourly * 1.67
         + greatest(p_hours - 8, 0) * p_hourly * 2.67)
    WHEN 'holiday' THEN
      CASE WHEN p_is_hourly THEN ceil(p_hours * p_hourly * 2)
           ELSE ceil(least(p_hours, 8) * p_hourly
                   + least(greatest(p_hours - 8, 0), 2) * p_hourly * 1.34
                   + greatest(p_hours - 10, 0) * p_hourly * 1.67) END
    WHEN 'weekly_off' THEN
      CASE WHEN p_is_hourly THEN ceil(p_hours * p_hourly * 2)
           ELSE ceil(p_hours * p_hourly) END
    ELSE 0 END
$$;

GRANT EXECUTE ON FUNCTION public._ot_pay_zh(numeric, numeric, text, boolean)
  TO authenticated, anon, service_role;


-- ──────────────────────────────────────────────────────────────────────────
-- helper：PT 投保金額（對齊 insuranceBrackets.js findPTInsuredSalary）
--   11100~29500 範圍，找第一個 >= salary;超過 → 29500;無級距 → 11100
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._find_pt_insured(p_year INT, p_salary numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pt AS (
    SELECT insured_salary FROM labor_ins_brackets
    WHERE year = p_year AND insured_salary >= 11100 AND insured_salary <= 29500
  )
  SELECT COALESCE(
    (SELECT insured_salary FROM pt WHERE insured_salary >= p_salary ORDER BY insured_salary LIMIT 1),
    CASE WHEN EXISTS (SELECT 1 FROM pt) THEN 29500 ELSE 11100 END
  )::numeric
$$;
GRANT EXECUTE ON FUNCTION public._find_pt_insured(INT, numeric) TO authenticated, anon, service_role;

-- ──────────────────────────────────────────────────────────────────────────
-- helper：勞保級距 row（對齊 payroll.js calculateLaborInsurance 路徑 A）
--   PT&forcePTmin → insured_salary=11100;FT → cap min(insured,45800)、找 >=29500 且 >=cap 的最低級
-- ──────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public._labor_bracket_row(INT, numeric, boolean);
CREATE OR REPLACE FUNCTION public._labor_bracket_row(p_year INT, p_insured numeric, p_ptlike boolean)
RETURNS TABLE(insured_salary numeric, employee_premium numeric, employer_premium numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cap numeric := LEAST(p_insured, 45800);
BEGIN
  IF p_ptlike THEN
    RETURN QUERY SELECT b.insured_salary, b.employee_premium, b.employer_premium
      FROM labor_ins_brackets b WHERE b.year=p_year AND b.insured_salary=11100 LIMIT 1;
    RETURN;
  END IF;
  RETURN QUERY SELECT b.insured_salary, b.employee_premium, b.employer_premium
    FROM labor_ins_brackets b
    WHERE b.year=p_year AND b.insured_salary>=29500 AND b.insured_salary>=v_cap
    ORDER BY b.insured_salary LIMIT 1;
  IF FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT b.insured_salary, b.employee_premium, b.employer_premium
    FROM labor_ins_brackets b WHERE b.year=p_year AND b.insured_salary=45800 LIMIT 1;
  IF FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT b.insured_salary, b.employee_premium, b.employer_premium
    FROM labor_ins_brackets b WHERE b.year=p_year ORDER BY b.insured_salary DESC LIMIT 1;
END $$;
GRANT EXECUTE ON FUNCTION public._labor_bracket_row(INT, numeric, boolean) TO authenticated, anon, service_role;

-- ──────────────────────────────────────────────────────────────────────────
-- helper：健保級距 row（對齊 payroll.js calculateHealthInsurance 路徑 A）
--   找 >=29500 且 >=insured 的最低級;超過最高 → 最高級
-- ──────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public._health_bracket_row(INT, numeric);
CREATE OR REPLACE FUNCTION public._health_bracket_row(p_year INT, p_insured numeric)
RETURNS TABLE(insured_salary numeric, employee_premium numeric, employer_premium numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY SELECT b.insured_salary, b.employee_premium, b.employer_premium
    FROM health_ins_brackets b
    WHERE b.year=p_year AND b.insured_salary>=29500 AND b.insured_salary>=p_insured
    ORDER BY b.insured_salary LIMIT 1;
  IF FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT b.insured_salary, b.employee_premium, b.employer_premium
    FROM health_ins_brackets b WHERE b.year=p_year ORDER BY b.insured_salary DESC LIMIT 1;
END $$;
GRANT EXECUTE ON FUNCTION public._health_bracket_row(INT, numeric) TO authenticated, anon, service_role;


-- ──────────────────────────────────────────────────────────────────────────
-- _compute_payroll_for_employee：單一員工試算（純計算、無副作用）
--   回 jsonb，欄位對齊 payrollCalc.js 的 row 物件。
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._compute_payroll_for_employee(
  p_emp_id INT,
  p_period TEXT          -- 'YYYY-MM'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp            employees;
  v_ss             salary_structures;
  v_year           INT  := split_part(p_period, '-', 1)::int;
  v_month          INT  := split_part(p_period, '-', 2)::int;
  v_mstart         date := make_date(v_year, v_month, 1);
  v_mend           date := (make_date(v_year, v_month, 1) + interval '1 month - 1 day')::date;
  v_total_days     INT  := extract(day from v_mend)::int;
  -- 分類
  v_is_hourly      boolean;
  v_emp_category   text;
  v_is_piece       boolean;
  v_is_ptlike      boolean;
  -- 出勤
  v_hours          numeric := 0;
  v_holiday_hours  numeric := 0;
  v_late_mins      numeric := 0;
  v_work_days      int := 0;
  v_store_id       int;
  v_tolerance      int;
  -- 津貼
  v_role_allow     numeric;
  v_meal           numeric;
  v_transport      numeric;
  v_att_bonus_base numeric;
  v_custom         jsonb;
  v_custom_total   numeric := 0;
  v_other_custom   numeric := 0;
  v_night          numeric;
  v_cross          numeric;
  v_night_struct   numeric;
  v_cross_struct   numeric;
  v_night_custom   numeric;
  v_cross_custom   numeric;
  v_dependents     int;
  v_vol_rate       numeric;
  -- 本薪
  v_base_salary    numeric;
  v_base_for_ins   numeric;
  v_hourly_rate    numeric;
  v_piece_count    numeric;
  v_piece_rate     numeric;
  -- OT
  v_ot_wd numeric:=0; v_ot_rd numeric:=0; v_ot_wo numeric:=0; v_ot_hd numeric:=0;
  v_otx_wd numeric:=0; v_otx_rd numeric:=0; v_otx_wo numeric:=0; v_otx_hd numeric:=0;
  v_ot_pay_wd numeric:=0; v_ot_pay_rd numeric:=0; v_ot_pay_wo numeric:=0; v_ot_pay_hd numeric:=0;
  v_otx_pay_wd numeric:=0; v_otx_pay_rd numeric:=0; v_otx_pay_wo numeric:=0; v_otx_pay_hd numeric:=0;
  v_ot_legal_total numeric:=0;
  v_ot_exc_total   numeric:=0;
  v_holiday_bonus  numeric:=0;
  v_comp_amt       numeric:=0;
  v_comp_cnt       int:=0;
  v_reg_ot         numeric:=0;
  v_extra_ot       numeric:=0;
  v_overtime_pay   numeric:=0;
  -- 請假/扣款
  v_unpaid_hours   numeric:=0;
  v_unpaid_days    numeric:=0;
  v_half_hours     numeric:=0;
  v_late_deduction numeric:=0;
  v_unpaid_deduct  numeric:=0;
  v_half_deduct    numeric:=0;
  v_absence_deduct numeric:=0;
  v_absence_days   numeric:=0;
  v_attendance_bonus numeric:=0;
  v_legal_total    numeric:=0;
  v_policy_bonus   numeric:=0;
  -- prorate
  v_join           date;
  v_resign         date;
  v_eff_start      date;
  v_eff_end        date;
  v_sal_ratio      numeric := 1;
  v_sal_actual     int;
  v_eff_base       numeric; v_eff_role numeric; v_eff_meal numeric; v_eff_transp numeric;
  v_eff_attb numeric; v_eff_night numeric; v_eff_cross numeric; v_eff_otherc numeric;
  v_eff_custom_total numeric;
  -- 投保
  v_insured        numeric;
  -- net 計算
  v_gross          numeric;
  v_labor_emp numeric:=0; v_labor_er numeric:=0; v_labor_insured numeric:=0;
  v_health_emp numeric:=0; v_health_er numeric:=0; v_health_insured numeric:=0;
  v_pension_self numeric:=0; v_pension_er numeric:=0; v_wage_grade numeric;
  v_total_deduct   numeric;
  v_net            numeric;
  -- partial month（保險 prorate，對齊 calculateInServiceDays）
  v_in_service     int;
  v_month_days     int := v_total_days;
  v_proration      numeric := 1;
  v_is_partial     boolean := false;
  v_prorated_labor numeric; v_prorated_pension numeric;
  v_prorated_laborE numeric; v_prorated_pensionE numeric;
  v_ins_delta      numeric;
  v_ot_ovt_for_net numeric;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_ss FROM salary_structures WHERE employee_id = p_emp_id;

  v_is_hourly    := COALESCE(v_ss.salary_type,'') = 'hourly';
  v_emp_category := v_ss.employment_category;
  v_is_piece     := COALESCE(v_emp_category = 'piece', false);   -- NULL→false（否則 NOT NULL 連鎖出錯）
  v_is_ptlike    := v_is_hourly OR v_is_piece;

  -- ── 員工所屬門市 id（給政策獎金 specificity 用）──
  SELECT id INTO v_store_id FROM stores WHERE name = v_emp.store LIMIT 1;

  -- ── 出勤聚合（遲到容忍依「打卡當下門市」late_tolerance_minutes，0/缺 → 5;對齊前端）──
  SELECT
    COALESCE(SUM(ar.total_hours),0),
    COALESCE(SUM(ar.total_hours) FILTER (WHERE h.is_workday IS FALSE),0),
    COALESCE(SUM(ar.late_minutes) FILTER (
      WHERE ar.is_late AND ar.late_minutes > COALESCE(NULLIF(st.late_tolerance_minutes,0),5)),0),
    COUNT(*)
  INTO v_hours, v_holiday_hours, v_late_mins, v_work_days
  FROM attendance_records ar
  LEFT JOIN holidays h ON h.date = ar.date
  LEFT JOIN stores st ON st.id = ar.store_id
  WHERE ar.employee_id = p_emp_id
    AND ar.date >= v_mstart AND ar.date <= v_mend;

  -- ── 津貼 ──
  v_role_allow     := COALESCE(v_ss.supervisor_allowance,0) + COALESCE(v_ss.role_allowance,0);
  v_meal           := COALESCE(v_ss.meal_allowance,0);
  v_transport      := COALESCE(v_ss.transport_allowance,0);
  v_att_bonus_base := COALESCE(v_ss.attendance_bonus,0);
  v_custom         := CASE WHEN jsonb_typeof(v_ss.custom_allowances)='array' THEN v_ss.custom_allowances ELSE '[]'::jsonb END;
  v_dependents     := COALESCE(v_ss.health_ins_dependents,0);
  v_vol_rate       := COALESCE(v_emp.labor_pension_self_rate,0) / 100.0;

  SELECT COALESCE(SUM((c->>'amount')::numeric),0) INTO v_custom_total
    FROM jsonb_array_elements(v_custom) c;
  SELECT COALESCE(SUM((c->>'amount')::numeric),0) INTO v_other_custom
    FROM jsonb_array_elements(v_custom) c
   WHERE (c->>'name') !~ '夜班|夜間|跨店|跨區';
  v_night_struct := COALESCE(v_ss.night_shift_allowance,0);
  v_cross_struct := COALESCE(v_ss.cross_store_allowance,0);
  SELECT COALESCE(MAX((c->>'amount')::numeric),0) INTO v_night_custom
    FROM jsonb_array_elements(v_custom) c WHERE (c->>'name') ~ '夜班|夜間';
  SELECT COALESCE(MAX((c->>'amount')::numeric),0) INTO v_cross_custom
    FROM jsonb_array_elements(v_custom) c WHERE (c->>'name') ~ '跨店|跨區';
  v_night := CASE WHEN v_night_struct > 0 THEN v_night_struct ELSE v_night_custom END;
  v_cross := CASE WHEN v_cross_struct > 0 THEN v_cross_struct ELSE v_cross_custom END;

  -- ── 本薪 ──
  v_piece_count := COALESCE(v_ss.current_piece_count,0);
  v_piece_rate  := COALESCE(v_ss.piece_rate,0);
  IF v_is_piece THEN
    v_base_salary := ceil(v_piece_count * v_piece_rate);
  ELSIF v_is_hourly THEN
    v_base_salary := ceil(COALESCE(v_ss.hourly_rate,0) * v_hours);
  ELSE
    v_base_salary := COALESCE(v_ss.base_salary, v_emp.base_salary, 0);
  END IF;

  v_base_for_ins := COALESCE(v_ss.base_salary, v_emp.base_salary, 0)
                  + v_role_allow + v_night + v_cross + v_meal + v_transport
                  + v_att_bonus_base + v_other_custom;

  v_hourly_rate := CASE WHEN v_is_hourly THEN COALESCE(v_ss.hourly_rate,0)
                        ELSE round(v_base_for_ins / 30.0 / 8.0, 2) END;

  -- ── 加班費（OT 四桶；分 legal / exception；weekday/restday/holiday 分日階梯，weekly_off 用總時數）──
  -- 桶總時數（給顯示）
  SELECT
    COALESCE(SUM(ot_hours) FILTER (WHERE NOT COALESCE(is_exception,false) AND cat='weekday'),0),
    COALESCE(SUM(ot_hours) FILTER (WHERE NOT COALESCE(is_exception,false) AND cat='restday'),0),
    COALESCE(SUM(ot_hours) FILTER (WHERE NOT COALESCE(is_exception,false) AND cat='weekly_off'),0),
    COALESCE(SUM(ot_hours) FILTER (WHERE NOT COALESCE(is_exception,false) AND cat='holiday'),0),
    COALESCE(SUM(ot_hours) FILTER (WHERE COALESCE(is_exception,false) AND cat='weekday'),0),
    COALESCE(SUM(ot_hours) FILTER (WHERE COALESCE(is_exception,false) AND cat='restday'),0),
    COALESCE(SUM(ot_hours) FILTER (WHERE COALESCE(is_exception,false) AND cat='weekly_off'),0),
    COALESCE(SUM(ot_hours) FILTER (WHERE COALESCE(is_exception,false) AND cat='holiday'),0)
  INTO v_ot_wd, v_ot_rd, v_ot_wo, v_ot_hd, v_otx_wd, v_otx_rd, v_otx_wo, v_otx_hd
  FROM (
    SELECT ot_hours, is_exception,
      COALESCE(NULLIF(ot_category,''),
        CASE extract(dow from request_date)::int WHEN 0 THEN 'weekly_off' WHEN 6 THEN 'restday' ELSE 'weekday' END
      ) AS cat
    FROM overtime_requests
    WHERE employee_id = p_emp_id AND status='已核准'
      AND request_date >= v_mstart AND request_date <= v_mend
  ) o;

  -- 分日階梯 pay：weekday/restday/holiday（per date+cat 加總後套 per-day 公式再加總）
  -- legal（is_exception=false）
  SELECT
    COALESCE(SUM(public._ot_pay_zh(dh, v_hourly_rate, cat, v_is_hourly)) FILTER (WHERE cat='weekday'),0),
    COALESCE(SUM(public._ot_pay_zh(dh, v_hourly_rate, cat, v_is_hourly)) FILTER (WHERE cat='restday'),0),
    COALESCE(SUM(public._ot_pay_zh(dh, v_hourly_rate, cat, v_is_hourly)) FILTER (WHERE cat='holiday'),0)
  INTO v_ot_pay_wd, v_ot_pay_rd, v_ot_pay_hd
  FROM (
    SELECT request_date, cat, SUM(ot_hours) dh FROM (
      SELECT request_date, ot_hours,
        COALESCE(NULLIF(ot_category,''),
          CASE extract(dow from request_date)::int WHEN 0 THEN 'weekly_off' WHEN 6 THEN 'restday' ELSE 'weekday' END) cat
      FROM overtime_requests
      WHERE employee_id=p_emp_id AND status='已核准' AND NOT COALESCE(is_exception,false)
        AND request_date >= v_mstart AND request_date <= v_mend
    ) x WHERE cat IN ('weekday','restday','holiday') GROUP BY request_date, cat
  ) d;
  v_ot_pay_wo := public._ot_pay_zh(v_ot_wo, v_hourly_rate, 'weekly_off', v_is_hourly);
  v_ot_legal_total := v_ot_pay_wd + v_ot_pay_rd + v_ot_pay_wo + v_ot_pay_hd;

  -- exception（is_exception=true）
  SELECT
    COALESCE(SUM(public._ot_pay_zh(dh, v_hourly_rate, cat, v_is_hourly)) FILTER (WHERE cat='weekday'),0),
    COALESCE(SUM(public._ot_pay_zh(dh, v_hourly_rate, cat, v_is_hourly)) FILTER (WHERE cat='restday'),0),
    COALESCE(SUM(public._ot_pay_zh(dh, v_hourly_rate, cat, v_is_hourly)) FILTER (WHERE cat='holiday'),0)
  INTO v_otx_pay_wd, v_otx_pay_rd, v_otx_pay_hd
  FROM (
    SELECT request_date, cat, SUM(ot_hours) dh FROM (
      SELECT request_date, ot_hours,
        COALESCE(NULLIF(ot_category,''),
          CASE extract(dow from request_date)::int WHEN 0 THEN 'weekly_off' WHEN 6 THEN 'restday' ELSE 'weekday' END) cat
      FROM overtime_requests
      WHERE employee_id=p_emp_id AND status='已核准' AND COALESCE(is_exception,false)
        AND request_date >= v_mstart AND request_date <= v_mend
    ) x WHERE cat IN ('weekday','restday','holiday') GROUP BY request_date, cat
  ) d;
  v_otx_pay_wo := public._ot_pay_zh(v_otx_wo, v_hourly_rate, 'weekly_off', v_is_hourly);
  v_ot_exc_total := v_otx_pay_wd + v_otx_pay_rd + v_otx_pay_wo + v_otx_pay_hd;

  -- 國定出勤加給（非計件 +×1）
  v_holiday_bonus := CASE WHEN NOT v_is_piece THEN ceil(v_holiday_hours * v_hourly_rate * 1) ELSE 0 END;

  -- 過期補休兌現（read-only：sum ceil(frozen × remaining/max(hours,1)))
  SELECT
    COALESCE(SUM(ceil(COALESCE(frozen_ot_amount,0) * (hours - hours_used) / GREATEST(hours,1))) FILTER (WHERE (hours-hours_used) > 0),0),
    COUNT(*) FILTER (WHERE (hours-hours_used) > 0)
  INTO v_comp_amt, v_comp_cnt
  FROM comp_time_ledger
  WHERE employee_id=p_emp_id AND status='active' AND expires_at < v_mend;

  v_reg_ot   := CASE WHEN v_is_piece THEN 0 ELSE v_ot_legal_total + v_holiday_bonus + v_comp_amt END;
  v_extra_ot := CASE WHEN v_is_piece THEN 0 ELSE v_ot_exc_total END;
  v_overtime_pay := v_reg_ot + v_extra_ot;

  -- ── 請假 ──
  SELECT
    COALESCE(SUM(CASE WHEN type IN ('事假','personal','無薪假','unpaid') THEN COALESCE(hours, COALESCE(days,0)*8) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN type IN ('事假','personal','無薪假','unpaid') THEN COALESCE(days,0) ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN type IN ('病假','sick','生理假','menstrual') THEN COALESCE(hours, COALESCE(days,0)*8) ELSE 0 END),0)
  INTO v_unpaid_hours, v_unpaid_days, v_half_hours
  FROM leave_requests
  WHERE employee_id=p_emp_id AND status='已核准'
    AND start_date >= v_mstart AND start_date <= v_mend;
  v_absence_days := v_unpaid_days;

  -- ── 法定扣款（fixed only，對齊前端 batch）──
  SELECT COALESCE(SUM(CASE WHEN deduction_type='fixed' OR deduction_type IS NULL THEN COALESCE(monthly_amount,0) ELSE 0 END),0)
  INTO v_legal_total
  FROM legal_deductions
  WHERE employee_id=p_emp_id AND status='進行中' AND started_month <= p_period;

  -- ── 政策獎金（batch: sales=0 → 只有 fixed 型有值；最具體優先 by code）──
  SELECT COALESCE(SUM(CASE WHEN (config->>'type')='fixed' THEN COALESCE((config->>'amount')::numeric,0) ELSE 0 END),0)
  INTO v_policy_bonus
  FROM (
    SELECT DISTINCT ON (code) code, config
    FROM benefit_policies
    WHERE category='bonus' AND is_active
      AND effective_from <= current_date AND (effective_to IS NULL OR effective_to >= current_date)
      AND ( (store_id IS NULL AND employee_id IS NULL)
         OR (store_id = v_store_id AND employee_id IS NULL)
         OR (employee_id = p_emp_id) )
    ORDER BY code, (CASE WHEN employee_id IS NOT NULL THEN 2 ELSE 0 END)+(CASE WHEN store_id IS NOT NULL THEN 1 ELSE 0 END) DESC
  ) b;

  -- ── 扣款金額 ──
  v_late_deduction := floor(v_late_mins/30) * floor(v_hourly_rate * 0.5);
  v_unpaid_deduct  := CASE WHEN v_is_hourly THEN 0 ELSE floor(v_unpaid_hours * v_hourly_rate) END;
  v_half_deduct    := CASE WHEN v_is_hourly THEN 0 ELSE floor(v_half_hours * v_hourly_rate * 0.5) END;
  v_absence_deduct := v_unpaid_deduct + v_half_deduct;
  v_attendance_bonus := CASE WHEN v_late_mins > 0 OR v_absence_days > 0 THEN 0 ELSE v_att_bonus_base END;

  -- ── 月薪 prorate（曆日制）──
  v_join   := CASE WHEN v_emp.join_date   IS NOT NULL THEN v_emp.join_date::date   END;
  v_resign := CASE WHEN v_emp.resign_date IS NOT NULL THEN v_emp.resign_date::date END;
  v_sal_actual := v_total_days;
  IF NOT v_is_hourly THEN
    v_eff_start := CASE WHEN v_join   IS NOT NULL AND v_join   > v_mstart THEN v_join   ELSE v_mstart END;
    v_eff_end   := CASE WHEN v_resign IS NOT NULL AND v_resign < v_mend   THEN v_resign ELSE v_mend   END;
    IF v_eff_start > v_mstart OR v_eff_end < v_mend THEN
      v_sal_actual := GREATEST((v_eff_end - v_eff_start) + 1, 1);
      v_sal_ratio  := v_sal_actual::numeric / v_total_days;
    END IF;
  END IF;

  IF NOT v_is_hourly THEN
    v_eff_base   := ceil(v_base_salary   * v_sal_ratio);
    v_eff_role   := ceil(v_role_allow    * v_sal_ratio);
    v_eff_meal   := ceil(v_meal          * v_sal_ratio);
    v_eff_transp := ceil(v_transport     * v_sal_ratio);
    v_eff_attb   := ceil(v_attendance_bonus * v_sal_ratio);
    v_eff_night  := ceil(v_night         * v_sal_ratio);
    v_eff_cross  := ceil(v_cross         * v_sal_ratio);
    v_eff_otherc := ceil(v_other_custom  * v_sal_ratio);
    v_eff_custom_total := ceil(v_custom_total * v_sal_ratio);
  ELSE
    v_eff_base:=v_base_salary; v_eff_role:=v_role_allow; v_eff_meal:=v_meal; v_eff_transp:=v_transport;
    v_eff_attb:=v_attendance_bonus; v_eff_night:=v_night; v_eff_cross:=v_cross; v_eff_otherc:=v_other_custom;
    v_eff_custom_total := v_custom_total;
  END IF;

  -- ── 投保金額 ──
  IF v_ss.base_insured IS NOT NULL AND v_ss.base_insured > 0 THEN
    v_insured := v_ss.base_insured;
  ELSIF v_is_ptlike THEN
    v_insured := public._find_pt_insured(v_year, v_base_salary + v_role_allow);
  ELSE
    v_insured := v_base_for_ins;
  END IF;

  -- ── calculateNetSalary ──
  v_ot_ovt_for_net := v_overtime_pay + v_eff_role + v_eff_night + v_eff_cross + v_eff_meal + v_eff_transp + v_eff_attb + v_eff_otherc;
  v_gross := v_eff_base + v_ot_ovt_for_net + v_policy_bonus;

  -- 勞保
  IF v_emp.labor_insurance IS NOT FALSE THEN
    SELECT insured_salary, employee_premium, employer_premium
      INTO v_labor_insured, v_labor_emp, v_labor_er
    FROM public._labor_bracket_row(v_year, v_insured, v_is_ptlike);
  END IF;
  v_labor_emp := COALESCE(v_labor_emp,0); v_labor_er := COALESCE(v_labor_er,0);

  -- 健保
  IF v_emp.health_insurance IS NOT FALSE THEN
    SELECT insured_salary, employee_premium, employer_premium
      INTO v_health_insured, v_health_emp, v_health_er
    FROM public._health_bracket_row(v_year, v_insured);
    v_health_emp := COALESCE(v_health_emp,0) * (1 + LEAST(v_dependents,3));
    v_health_er  := COALESCE(v_health_er,0);
  END IF;
  v_health_emp := COALESCE(v_health_emp,0); v_health_er := COALESCE(v_health_er,0);

  -- 勞退（以 effBase 計）
  v_wage_grade  := LEAST(v_eff_base, 150000);
  v_pension_er  := round(v_wage_grade * 0.06);
  v_pension_self := round(v_wage_grade * LEAST(GREATEST(v_vol_rate,0),0.06));

  v_total_deduct := v_labor_emp + v_health_emp + v_pension_self + 0
                  + (v_absence_deduct + v_late_deduction + v_legal_total);
  v_net := ceil(v_gross - v_total_deduct);

  -- ── partial month 保險 prorate（calculateInServiceDays）──
  DECLARE
    v_hire date := COALESCE(v_join, v_mstart);
    v_res  date := COALESCE(v_resign, v_mend);
    v_pstart date; v_pend date;
  BEGIN
    v_pstart := GREATEST(v_hire, v_mstart);
    v_pend   := LEAST(v_res, v_mend);
    IF v_pend < v_pstart THEN v_in_service := 0;
    ELSE v_in_service := (v_pend - v_pstart) + 1; END IF;
  END;
  v_proration := CASE WHEN v_month_days > 0 THEN v_in_service::numeric / v_month_days ELSE 1 END;
  v_is_partial := v_proration < 1 AND v_proration > 0;

  IF v_is_partial THEN
    v_prorated_labor   := floor(v_labor_emp   * v_proration);
    v_prorated_pension := floor(v_pension_self* v_proration);
    v_prorated_laborE  := ceil(v_labor_er     * v_proration);
    v_prorated_pensionE:= ceil(v_pension_er   * v_proration);
    v_ins_delta := (v_labor_emp + v_pension_self) - (v_prorated_labor + v_prorated_pension);
    v_total_deduct := v_total_deduct - v_ins_delta;
    v_labor_emp := v_prorated_labor;
    v_pension_self := v_prorated_pension;
    v_labor_er := v_prorated_laborE;
    v_pension_er := v_prorated_pensionE;
    v_net := ceil(v_gross - v_total_deduct);
  END IF;

  RETURN jsonb_build_object(
    'employee', v_emp.name,
    'employee_id', v_emp.id,
    'dept', COALESCE(v_emp.dept,''),
    'department_id', v_emp.department_id,
    'position', COALESCE(v_emp.position,''),
    'store', COALESCE(v_emp.store,''),
    'base_salary', v_eff_base,
    'role_allowance', v_eff_role,
    'meal_allowance', v_eff_meal,
    'transport_allowance', v_eff_transp,
    'night_allowance', v_eff_night,
    'cross_store_allowance', v_eff_cross,
    'other_custom_total', GREATEST(v_eff_otherc,0),
    'attendance_bonus', v_eff_attb,
    'custom_allowances', v_custom,
    'custom_allowances_total', v_eff_custom_total,
    'regular_overtime_pay', v_reg_ot,
    'extra_overtime_pay', v_extra_ot,
    'overtimePay', v_overtime_pay,
    'comp_time_settled_pay', v_comp_amt,
    'comp_time_settled_count', v_comp_cnt,
    'policyBonus', v_policy_bonus,
    'workDays', v_work_days,
    'workHours', v_hours,
    'holidayHours', v_holiday_hours,
    'holidayBonus', v_holiday_bonus,
    'otWeekday', v_ot_wd, 'otRestday', v_ot_rd, 'otWeeklyOff', v_ot_wo, 'otHoliday', v_ot_hd,
    'otPayWeekday', v_ot_pay_wd, 'otPayRestday', v_ot_pay_rd, 'otPayWeeklyOff', v_ot_pay_wo, 'otPayHoliday', v_ot_pay_hd,
    'absenceDays', v_absence_days, 'unpaidHours', v_unpaid_hours, 'halfPayHours', v_half_hours,
    'lateMins', v_late_mins
  ) || jsonb_build_object(
    'absenceDeduction', v_absence_deduct,
    'unpaidDeduction', v_unpaid_deduct,
    'halfPayDeduction', v_half_deduct,
    'lateDeduction', v_late_deduction,
    'legal_deduction', v_legal_total,
    'health_ins_dependents', v_dependents,
    'pension_self_pct', COALESCE(v_emp.labor_pension_self_rate,0),
    'in_service_days', v_in_service,
    'month_days', v_month_days,
    'proration_ratio', v_proration,
    'is_partial_month', v_is_partial,
    'salary_prorate_ratio', v_sal_ratio,
    'salary_actual_wd', v_sal_actual,
    'salary_total_wd', v_total_days,
    'join_date', v_emp.join_date,
    'resign_date', v_emp.resign_date,
    '_is_hourly', v_is_hourly,
    '_hourly_rate', v_hourly_rate,
    '_base_for_insure', v_base_for_ins,
    '_insured_salary', v_insured,
    -- calculateNetSalary 結果（攤平）
    'gross', v_gross,
    'insuredLabor', COALESCE(v_labor_insured,0),
    'insuredHealth', COALESCE(v_health_insured,0),
    'laborInsurance', v_labor_emp,
    'healthInsurance', v_health_emp,
    'pension', v_pension_self,
    'incomeTax', 0,
    'totalDeductions', v_total_deduct,
    'netSalary', v_net,
    'laborEmployer', v_labor_er,
    'healthEmployer', v_health_er,
    'pensionEmployer', v_pension_er
  );
END $$;

GRANT EXECUTE ON FUNCTION public._compute_payroll_for_employee(INT, TEXT)
  TO authenticated, service_role;


-- ──────────────────────────────────────────────────────────────────────────
-- preview_payroll：批次試算（loop scoped employees）
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.preview_payroll(
  p_period       TEXT,
  p_org          INT,
  p_store_filter TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_year   INT  := split_part(p_period,'-',1)::int;
  v_month  INT  := split_part(p_period,'-',2)::int;
  v_mend   date := (make_date(v_year, v_month, 1) + interval '1 month - 1 day')::date;
  v_result json;
BEGIN
  SELECT COALESCE(json_agg(public._compute_payroll_for_employee(e.id, p_period) ORDER BY e.name), '[]'::json)
    INTO v_result
  FROM employees e
  WHERE e.organization_id = p_org
    -- 員工範圍對齊前端 Salary.jsx：在職 + 近一個月內離職（相對今日，非計薪月）
    AND ( e.status = '在職'
       OR (e.status = '離職' AND e.resign_date >= (date_trunc('month', current_date) - interval '1 month')::date) )
    AND (e.join_date IS NULL OR e.join_date <= v_mend)
    AND (
      p_store_filter IS NULL
      OR e.store = p_store_filter
      OR (e.additional_stores IS NOT NULL AND p_store_filter = ANY(e.additional_stores))
    );
  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.preview_payroll(TEXT, INT, TEXT)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
