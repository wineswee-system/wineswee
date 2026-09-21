-- 計薪 #2：勞健保改吃「固定投保級距」(preview/_compute)
-- 2026-07-08
-- 需求：勞健保保費不要每月從薪資浮動，改讀員工登記的固定投保級距。
--   勞保→employees.labor_ins_grade；健保→employees.health_ins_grade。
--   過渡期(級距欄還沒補完)：該欄 NULL/0 → fallback 回現行 v_insured 計法，
--   所以級距全空的當下此改動是 no-op(與現況完全一致)，補級距後逐人切固定。
-- 只改 _compute(preview 用)；generate_payroll(入帳) 待 preview 比對確認後另辦。
-- 手法：抓 live 完整定義只換 4 處(各 assert 1 次)，其餘一字不動。idempotent。

CREATE OR REPLACE FUNCTION public._compute_payroll_for_employee(p_emp_id integer, p_period text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- 行政固定辦公時間 + 遲到/早退寬限（讀該員工門市；沒開固定辦公時間 → NULL 走 fallback）
  v_office_start_min numeric;   -- office_hours_start（分鐘）；NULL=沒開固定辦公時間
  v_office_end_min   numeric;   -- office_hours_end（分鐘）；NULL=沒開固定辦公時間
  v_admin_grace      numeric := 30;  -- 行政遲到/早退寬限；讀門市 late_tolerance_minutes
  v_start_base       numeric;   -- 應上班（分鐘）= office_start 或 fallback 540(09:00)
  v_end_base         numeric;   -- 浮動下限（分鐘）= office_end 或 fallback 1080(18:00)
  v_span             numeric;   -- 工時 span = end_base − start_base（含休息，浮動用）
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
  v_early_mins      numeric:=0;
  v_early_deduction numeric:=0;
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
  v_effd_start     date;
  v_effd_end       date;
  v_eff_end        date;
  v_sal_ratio      numeric := 1;
  v_sal_actual     int;
  v_eff_base       numeric; v_eff_role numeric; v_eff_meal numeric; v_eff_transp numeric;
  v_eff_attb numeric; v_eff_night numeric; v_eff_cross numeric; v_eff_otherc numeric;
  v_eff_custom_total numeric;
  -- 投保
  v_insured        numeric;
  v_labor_ins_base  numeric;
  v_health_ins_base numeric;
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
  -- B2: 離職特休結清 + 二代健保補充保費
  v_is_final       boolean := false;
  v_unused_days    numeric := 0;
  v_unused_payout  numeric := 0;
  v_nhi_supp       numeric := 0;
  v_nhi_breakdown  jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN NULL; END IF;
  v_effd_start := GREATEST(v_mstart, COALESCE(v_emp.join_date::date,   v_mstart));
  v_effd_end   := LEAST  (v_mend,   COALESCE(v_emp.resign_date::date, v_mend));
  SELECT * INTO v_ss FROM salary_structures WHERE employee_id = p_emp_id;

  v_is_hourly    := COALESCE(v_ss.salary_type,'') = 'hourly';
  v_emp_category := v_ss.employment_category;
  v_is_piece     := COALESCE(v_emp_category = 'piece', false);   -- NULL→false（否則 NOT NULL 連鎖出錯）
  v_is_ptlike    := v_is_hourly OR v_is_piece;

  -- ── 員工所屬門市 id（給政策獎金 specificity 用）──
  SELECT id INTO v_store_id FROM stores WHERE name = v_emp.store LIMIT 1;

  -- ── 行政固定辦公時間 + 遲到寬限（讀該員工門市設定；接「打卡規則設定」UI）──
  --   有開「固定辦公時間」(has_office_hours) → 用 office_hours_start/end；否則 NULL 走 fallback。
  --   遲到/早退寬限 → late_tolerance_minutes（0 是合法值=無寬限，只有查無門市/NULL 才 fallback 30）。
  SELECT
    CASE WHEN st.has_office_hours THEN EXTRACT(EPOCH FROM st.office_hours_start::time)/60.0 END,
    CASE WHEN st.has_office_hours THEN EXTRACT(EPOCH FROM st.office_hours_end::time)/60.0 END,
    st.late_tolerance_minutes
  INTO v_office_start_min, v_office_end_min, v_admin_grace
  FROM stores st WHERE st.id = v_store_id;
  v_admin_grace := COALESCE(v_admin_grace, 30);  -- 查無門市/NULL → 30；門市設 0 則保留 0
  -- 浮動基準：有開固定辦公時間 → 用設定；否則 fallback 09:00–18:00。
  --   應下班 = clamp(打卡 + span, end_base, end_base + 遲到容許) → 保持浮動、上限=下班+寬限。
  v_start_base := COALESCE(v_office_start_min, 540);    -- 09:00
  v_end_base   := COALESCE(v_office_end_min, 1080);     -- 18:00
  v_span       := v_end_base - v_start_base;            -- 09:00–18:00 = 540(9h 含休息)

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
    AND ar.date >= v_effd_start AND ar.date <= v_effd_end;

  -- ── 遲到/早退（per-minute = 分鐘 × 時薪/60；計件不扣）──
  --   統一邏輯：有班表(actual_start/end)就用班表；admin 沒班表才退回固定 09:00–18:00(應下班 clamp(clock_in+9h,18:00,18:30))。
  --   寬限(grace)看分類：admin 30 分、其他 0；非 admin 又沒班表 → 該日不算(ast/ae 為 NULL)。
  --   時間用 EXTRACT(EPOCH FROM x::time)/60 → 離午夜分鐘；clock_out < clock_in 表跨午夜 +1440；班表跨午夜(ae<=ast)+1440。早打卡不給 credit。
  IF NOT v_is_piece THEN
    SELECT
      COALESCE(SUM(GREATEST(0, ci - ast - grace)) FILTER (WHERE ast IS NOT NULL),0),
      COALESCE(SUM(GREATEST(0, (ae + CASE WHEN ae <= ast THEN 1440 ELSE 0 END) - cot)) FILTER (WHERE ae IS NOT NULL AND has_out AND NOT has_el),0)
      INTO v_late_mins, v_early_mins
    FROM (
      SELECT
        EXTRACT(EPOCH FROM ar.clock_in::time)/60.0 AS ci,
        (EXTRACT(EPOCH FROM ar.clock_out::time)/60.0)
          + CASE WHEN ar.clock_out IS NOT NULL
                  AND EXTRACT(EPOCH FROM ar.clock_out::time) < EXTRACT(EPOCH FROM ar.clock_in::time)
                 THEN 1440 ELSE 0 END AS cot,
        COALESCE(EXTRACT(EPOCH FROM s.actual_start::time)/60.0,
                 CASE WHEN COALESCE(v_emp_category,'')='admin' THEN v_start_base ELSE NULL END) AS ast,
        COALESCE(EXTRACT(EPOCH FROM s.actual_end::time)/60.0,
                 CASE WHEN COALESCE(v_emp_category,'')='admin'
                      THEN LEAST(GREATEST(EXTRACT(EPOCH FROM ar.clock_in::time)/60.0 + v_span, v_end_base), v_end_base + v_admin_grace)
                      ELSE NULL END) AS ae,
        CASE WHEN COALESCE(v_emp_category,'')='admin' THEN v_admin_grace ELSE 0 END AS grace,
        (ar.clock_out IS NOT NULL) AS has_out,
        EXISTS (SELECT 1 FROM public.early_leave_records elr WHERE elr.employee_id = ar.employee_id AND elr.date = ar.date) AS has_el
      FROM attendance_records ar
      LEFT JOIN schedules s ON s.employee_id = ar.employee_id AND s.date = ar.date
      LEFT JOIN holidays hh ON hh.date = ar.date
      WHERE ar.employee_id = p_emp_id AND ar.date >= v_effd_start AND ar.date <= v_effd_end
        AND ar.clock_in IS NOT NULL
        -- 國定假日 / 行政遇週末 → 沒正常班，不算遲到早退
        AND NOT (COALESCE(hh.is_workday = false, false)
                 OR (COALESCE(v_emp_category,'') = 'admin' AND EXTRACT(DOW FROM ar.date) IN (0,6)))
        -- 排除「有核准請假」的日子：請假提早走/晚到不該再扣早退/遲到（避免跟請假扣重複）
        AND NOT EXISTS (
          SELECT 1 FROM leave_requests lr
          WHERE lr.employee_id = ar.employee_id AND lr.status = '已核准'
            AND ar.date BETWEEN lr.start_date AND COALESCE(lr.end_date, lr.start_date)
        )
    ) x;
    v_late_mins  := COALESCE(v_late_mins,0);
    v_early_mins := COALESCE(v_early_mins,0);
  END IF;

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
  v_piece_count := COALESCE(
    (SELECT pc.piece_count FROM employee_piece_counts pc WHERE pc.employee_id = p_emp_id AND pc.year_month = p_period),
    v_ss.current_piece_count, 0);
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
      AND request_date >= v_effd_start AND request_date <= v_effd_end
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
        AND request_date >= v_effd_start AND request_date <= v_effd_end
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
        AND request_date >= v_effd_start AND request_date <= v_effd_end
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
  v_late_deduction  := floor(v_late_mins  * v_hourly_rate / 60.0);  -- per-minute,無條件捨去
  v_early_deduction := floor(v_early_mins * v_hourly_rate / 60.0);
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

  -- ── B2: 離職特休結清（離職當月把沒休完特休折現,計入 gross；對齊入帳 generate_payroll）──
  v_is_final := (v_emp.status = '離職');
  IF v_is_final THEN
    SELECT COALESCE(SUM(GREATEST(total_days + carry_over_days - used_days, 0)),0)
      INTO v_unused_days
    FROM leave_balances
    WHERE employee_id = p_emp_id AND year = v_year
      AND leave_type IN ('特休','annual','特別休假');
    IF NOT v_is_hourly THEN
      v_unused_payout := ceil(v_unused_days * (v_base_salary / NULLIF(v_total_days,0)));
    ELSE
      v_unused_payout := ceil(v_unused_days * v_hourly_rate * 8);
    END IF;
  END IF;

  -- ── calculateNetSalary ──
  v_ot_ovt_for_net := v_overtime_pay + v_eff_role + v_eff_night + v_eff_cross + v_eff_meal + v_eff_transp + v_eff_attb + v_eff_otherc;
  v_gross := v_eff_base + v_ot_ovt_for_net + v_policy_bonus + v_unused_payout;

  -- 固定投保級距：勞健保各自讀 employees.*_ins_grade；空(NULL/0)→fallback 現行 v_insured
  v_labor_ins_base  := COALESCE(NULLIF(v_emp.labor_ins_grade, 0), v_insured);
  v_health_ins_base := COALESCE(NULLIF(v_emp.health_ins_grade, 0), v_insured);

  -- 勞保
  IF v_emp.labor_insurance IS NOT FALSE THEN
    SELECT insured_salary, employee_premium, employer_premium
      INTO v_labor_insured, v_labor_emp, v_labor_er
    FROM public._labor_bracket_row(v_year, v_labor_ins_base, v_is_ptlike);
  END IF;
  v_labor_emp := COALESCE(v_labor_emp,0); v_labor_er := COALESCE(v_labor_er,0);

  -- 健保
  IF v_emp.health_insurance IS NOT FALSE THEN
    SELECT insured_salary, employee_premium, employer_premium
      INTO v_health_insured, v_health_emp, v_health_er
    FROM public._health_bracket_row(v_year, v_health_ins_base);
    v_health_emp := COALESCE(v_health_emp,0) * (1 + LEAST(v_dependents,3));
    v_health_er  := COALESCE(v_health_er,0);
  END IF;
  v_health_emp := COALESCE(v_health_emp,0); v_health_er := COALESCE(v_health_er,0);

  -- ── B2: 二代健保補充保費（門檻用覈實投保 v_health_insured；讀 annual_bonus_tracker 唯讀）──
  IF v_health_insured > 0 THEN
    -- 加班費超過投保金額 → 超額 ×2.11%
    IF v_overtime_pay > v_health_insured THEN
      v_nhi_supp := v_nhi_supp + floor((v_overtime_pay - v_health_insured) * 0.0211);
      v_nhi_breakdown := v_nhi_breakdown || jsonb_build_object(
        'category','加班費超額','income',v_overtime_pay,'exempt',v_health_insured,
        'taxable',v_overtime_pay - v_health_insured,'rate',0.0211,
        'premium',floor((v_overtime_pay - v_health_insured) * 0.0211));
    END IF;
    -- 高額獎金累計 > 4 倍投保 → 超過 ×2.11%（獎金=全勤獎金,對齊入帳）
    DECLARE
      v_bonus numeric := v_eff_attb;
      v_4x    numeric := v_health_insured * 4;
      v_prev  numeric := 0;
      v_newc  numeric;
      v_taxb  numeric := 0;
    BEGIN
      IF v_bonus > 0 THEN
        SELECT cumulative_bonus INTO v_prev FROM annual_bonus_tracker
         WHERE employee_id = p_emp_id AND year = v_year;
        v_prev := COALESCE(v_prev,0);
        v_newc := v_prev + v_bonus;
        IF v_newc > v_4x AND v_prev < v_4x THEN v_taxb := v_newc - v_4x;
        ELSIF v_prev >= v_4x THEN v_taxb := v_bonus; END IF;
        IF v_taxb > 0 THEN
          v_nhi_supp := v_nhi_supp + floor(v_taxb * 0.0211);
          v_nhi_breakdown := v_nhi_breakdown || jsonb_build_object(
            'category','高額獎金累計','income',v_bonus,'cumulative',v_newc,
            'threshold_4x',v_4x,'taxable',v_taxb,'rate',0.0211,'premium',floor(v_taxb*0.0211));
        END IF;
      END IF;
    END;
  END IF;

  -- 勞退（以 effBase 計）
  v_wage_grade  := LEAST(v_eff_base, 150000);
  v_pension_er  := CASE WHEN COALESCE(v_emp.pension, false) THEN round(v_wage_grade * COALESCE(v_emp.pension_rate,6)/100.0) ELSE 0 END;
  v_pension_self := round(v_wage_grade * LEAST(GREATEST(v_vol_rate,0),0.06));

  v_total_deduct := v_labor_emp + v_health_emp + v_pension_self + 0
                  + (v_absence_deduct + v_late_deduction + v_early_deduction + v_legal_total + v_nhi_supp);
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
    'earlyLeaveDeduction', v_early_deduction,
    'earlyLeaveMinutes', v_early_mins,
    'legal_deduction', v_legal_total,
    'nhi_supplementary', v_nhi_supp,
    'nhi_supplementary_breakdown', v_nhi_breakdown,
    'unused_leave_payout', v_unused_payout,
    'unused_leave_days', v_unused_days,
    'is_final_settlement', v_is_final,
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
  ) || jsonb_build_object(
    -- ── 逐日明細（給公式視窗的明細表用）──
    '_ot_rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', request_date, 'hours', ot_hours,
        'category', COALESCE(NULLIF(ot_category,''), CASE extract(dow from request_date)::int WHEN 0 THEN 'weekly_off' WHEN 6 THEN 'restday' ELSE 'weekday' END)) ORDER BY request_date)
      FROM overtime_requests WHERE employee_id=p_emp_id AND status='已核准' AND NOT COALESCE(is_exception,false)
        AND request_date>=v_effd_start AND request_date<=v_effd_end), '[]'::jsonb),
    '_ot_exception_rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', request_date, 'hours', ot_hours,
        'category', COALESCE(NULLIF(ot_category,''), CASE extract(dow from request_date)::int WHEN 0 THEN 'weekly_off' WHEN 6 THEN 'restday' ELSE 'weekday' END)) ORDER BY request_date)
      FROM overtime_requests WHERE employee_id=p_emp_id AND status='已核准' AND COALESCE(is_exception,false)
        AND request_date>=v_effd_start AND request_date<=v_effd_end), '[]'::jsonb),
    '_leave_rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', start_date, 'type', type, 'hours', hours, 'days', days) ORDER BY start_date)
      FROM leave_requests WHERE employee_id=p_emp_id AND status='已核准'
        AND start_date>=v_mstart AND start_date<=v_mend), '[]'::jsonb),
    '_late_rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', dt, 'late_minutes', round(lm)) ORDER BY dt)
      FROM (
        SELECT y.dt, GREATEST(0, y.ci - y.ast - y.grace) AS lm
        FROM (
          SELECT ar.date AS dt,
            EXTRACT(EPOCH FROM ar.clock_in::time)/60.0 AS ci,
            COALESCE(EXTRACT(EPOCH FROM s.actual_start::time)/60.0, CASE WHEN COALESCE(v_emp_category,'')='admin' THEN v_start_base ELSE NULL END) AS ast,
            CASE WHEN COALESCE(v_emp_category,'')='admin' THEN v_admin_grace ELSE 0 END AS grace
          FROM attendance_records ar
          LEFT JOIN schedules s ON s.employee_id=ar.employee_id AND s.date=ar.date
          LEFT JOIN holidays hh ON hh.date=ar.date
          WHERE ar.employee_id=p_emp_id AND ar.date>=v_effd_start AND ar.date<=v_effd_end AND ar.clock_in IS NOT NULL AND NOT v_is_piece
            AND NOT (COALESCE(hh.is_workday = false, false) OR (COALESCE(v_emp_category,'') = 'admin' AND EXTRACT(DOW FROM ar.date) IN (0,6)))
            AND NOT EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.employee_id=ar.employee_id AND lr.status='已核准' AND ar.date BETWEEN lr.start_date AND COALESCE(lr.end_date,lr.start_date))
        ) y WHERE y.ast IS NOT NULL
      ) q WHERE lm > 0), '[]'::jsonb),
    '_early_rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', dt, 'early_minutes', round(em)) ORDER BY dt)
      FROM (
        SELECT y.dt, CASE WHEN y.ae IS NOT NULL AND y.has_out AND NOT y.has_el THEN GREATEST(0, (y.ae + CASE WHEN y.ae<=y.ast THEN 1440 ELSE 0 END) - y.cot) ELSE 0 END AS em
        FROM (
          SELECT ar.date AS dt,
            EXTRACT(EPOCH FROM ar.clock_in::time)/60.0 AS ci,
            (EXTRACT(EPOCH FROM ar.clock_out::time)/60.0) + CASE WHEN ar.clock_out IS NOT NULL AND EXTRACT(EPOCH FROM ar.clock_out::time)<EXTRACT(EPOCH FROM ar.clock_in::time) THEN 1440 ELSE 0 END AS cot,
            COALESCE(EXTRACT(EPOCH FROM s.actual_start::time)/60.0, CASE WHEN COALESCE(v_emp_category,'')='admin' THEN v_start_base ELSE NULL END) AS ast,
            COALESCE(EXTRACT(EPOCH FROM s.actual_end::time)/60.0, CASE WHEN COALESCE(v_emp_category,'')='admin' THEN LEAST(GREATEST(EXTRACT(EPOCH FROM ar.clock_in::time)/60.0+v_span,v_end_base),v_end_base + v_admin_grace) ELSE NULL END) AS ae,
            (ar.clock_out IS NOT NULL) AS has_out,
        EXISTS (SELECT 1 FROM public.early_leave_records elr WHERE elr.employee_id = ar.employee_id AND elr.date = ar.date) AS has_el
          FROM attendance_records ar
          LEFT JOIN schedules s ON s.employee_id=ar.employee_id AND s.date=ar.date
          LEFT JOIN holidays hh ON hh.date=ar.date
          WHERE ar.employee_id=p_emp_id AND ar.date>=v_effd_start AND ar.date<=v_effd_end AND ar.clock_in IS NOT NULL AND NOT v_is_piece
            AND NOT (COALESCE(hh.is_workday = false, false) OR (COALESCE(v_emp_category,'') = 'admin' AND EXTRACT(DOW FROM ar.date) IN (0,6)))
            AND NOT EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.employee_id=ar.employee_id AND lr.status='已核准' AND ar.date BETWEEN lr.start_date AND COALESCE(lr.end_date,lr.start_date))
        ) y
      ) q WHERE em > 0), '[]'::jsonb)
  );
END $function$;

NOTIFY pgrst, 'reload schema';
