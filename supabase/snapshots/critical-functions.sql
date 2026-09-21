-- ⚠️ 自動產生，請勿手改 —— npm run db:drift
-- 此檔是「關鍵 DB 函式」在 live DB 的定義快照。
-- git diff 此檔有變 = 有人在 DB 改了函式（可能是 Studio hotfix 沒回填 migration）。

-- ═══════════ _calc_monthly_withholding(p_gross numeric) ═══════════
CREATE OR REPLACE FUNCTION public._calc_monthly_withholding(p_gross numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- 公司政策：所得稅不代扣（員工自行申報）→ 代扣稅額一律 0
  SELECT 0::numeric
$function$
;

-- ═══════════ _compute_ot_pay(p_hours numeric, p_hourly_rate numeric, p_category text) ═══════════
CREATE OR REPLACE FUNCTION public._compute_ot_pay(p_hours numeric, p_hourly_rate numeric, p_category text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
  IF p_hours IS NULL OR p_hours <= 0 OR p_hourly_rate IS NULL OR p_hourly_rate <= 0 THEN
    RETURN 0;
  END IF;

  IF p_category = 'weekday' THEN
    RETURN CEIL(
      LEAST(p_hours, 2) * p_hourly_rate * 1.34
      + GREATEST(p_hours - 2, 0) * p_hourly_rate * 1.67
    );
  END IF;

  -- restday / weekly_off / holiday → 用 restday tiered
  RETURN CEIL(
    LEAST(p_hours, 2) * p_hourly_rate * 1.34
    + LEAST(GREATEST(p_hours - 2, 0), 6) * p_hourly_rate * 1.67
    + GREATEST(p_hours - 8, 0) * p_hourly_rate * 2.67
  );
END $function$
;

-- ═══════════ _compute_ot_pay(p_hours numeric, p_hourly_rate numeric, p_category text, p_salary_type text) ═══════════
CREATE OR REPLACE FUNCTION public._compute_ot_pay(p_hours numeric, p_hourly_rate numeric, p_category text, p_salary_type text DEFAULT 'monthly'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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

  -- 國定假日：FT ≤8h ×1（月薪已含當日）、>8h §24 延長（前2h ×1.34、再 ×1.67）/ PT ×2 全程
  IF p_category = 'holiday' THEN
    IF v_is_ft THEN
      RETURN CEIL(
        LEAST(p_hours, 8) * p_hourly_rate * 1.0
        + LEAST(GREATEST(p_hours - 8, 0), 2) * p_hourly_rate * 1.34
        + GREATEST(p_hours - 10, 0) * p_hourly_rate * 1.67
      );
    ELSE
      RETURN CEIL(p_hours * p_hourly_rate * 2.0);
    END IF;
  END IF;

  -- 例假：FT ×1（另有補休 ledger，§40 加發 1 倍）/ PT ×2（無補休）
  IF p_category = 'weekly_off' THEN
    IF v_is_ft THEN
      RETURN CEIL(p_hours * p_hourly_rate * 1.0);
    ELSE
      RETURN CEIL(p_hours * p_hourly_rate * 2.0);
    END IF;
  END IF;

  -- 休息日（restday）：FT/PT 都用階梯 1.34/1.67/2.67
  RETURN CEIL(
    LEAST(p_hours, 2) * p_hourly_rate * 1.34
    + LEAST(GREATEST(p_hours - 2, 0), 6) * p_hourly_rate * 1.67
    + GREATEST(p_hours - 8, 0) * p_hourly_rate * 2.67
  );
END $function$
;

-- ═══════════ _compute_payroll_for_employee(p_emp_id integer, p_period text) ═══════════
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
  -- B2: 離職特休結清 + 二代健保補充保費
  v_is_final       boolean := false;
  v_unused_days    numeric := 0;
  v_unused_payout  numeric := 0;
  v_nhi_supp       numeric := 0;
  v_nhi_breakdown  jsonb := '[]'::jsonb;
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

  -- ── 行政固定辦公時間 + 遲到寬限（讀該員工門市設定；接「打卡規則設定」UI）──
  --   有開「固定辦公時間」(has_office_hours) → 用 office_hours_start/end；否則 NULL 走 fallback。
  --   遲到/早退寬限 → late_tolerance_minutes（0/缺 → 5；門市非 admin 仍固定 0，不吃此值）。
  SELECT
    CASE WHEN st.has_office_hours THEN EXTRACT(EPOCH FROM st.office_hours_start::time)/60.0 END,
    CASE WHEN st.has_office_hours THEN EXTRACT(EPOCH FROM st.office_hours_end::time)/60.0 END,
    COALESCE(NULLIF(st.late_tolerance_minutes,0),5)
  INTO v_office_start_min, v_office_end_min, v_admin_grace
  FROM stores st WHERE st.id = v_store_id;
  v_admin_grace := COALESCE(v_admin_grace, 30);
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
    AND ar.date >= v_mstart AND ar.date <= v_mend;

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
      WHERE ar.employee_id = p_emp_id AND ar.date >= v_mstart AND ar.date <= v_mend
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
  v_pension_er  := round(v_wage_grade * 0.06);
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
        AND request_date>=v_mstart AND request_date<=v_mend), '[]'::jsonb),
    '_ot_exception_rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', request_date, 'hours', ot_hours,
        'category', COALESCE(NULLIF(ot_category,''), CASE extract(dow from request_date)::int WHEN 0 THEN 'weekly_off' WHEN 6 THEN 'restday' ELSE 'weekday' END)) ORDER BY request_date)
      FROM overtime_requests WHERE employee_id=p_emp_id AND status='已核准' AND COALESCE(is_exception,false)
        AND request_date>=v_mstart AND request_date<=v_mend), '[]'::jsonb),
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
          WHERE ar.employee_id=p_emp_id AND ar.date>=v_mstart AND ar.date<=v_mend AND ar.clock_in IS NOT NULL AND NOT v_is_piece
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
          WHERE ar.employee_id=p_emp_id AND ar.date>=v_mstart AND ar.date<=v_mend AND ar.clock_in IS NOT NULL AND NOT v_is_piece
            AND NOT (COALESCE(hh.is_workday = false, false) OR (COALESCE(v_emp_category,'') = 'admin' AND EXTRACT(DOW FROM ar.date) IN (0,6)))
            AND NOT EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.employee_id=ar.employee_id AND lr.status='已核准' AND ar.date BETWEEN lr.start_date AND COALESCE(lr.end_date,lr.start_date))
        ) y
      ) q WHERE em > 0), '[]'::jsonb)
  );
END $function$
;

-- ═══════════ _employee_matches_chain_step(p_emp_id bigint, p_step_id integer, p_applicant_emp_id integer, p_via_delegation boolean) ═══════════
CREATE OR REPLACE FUNCTION public._employee_matches_chain_step(p_emp_id bigint, p_step_id integer, p_applicant_emp_id integer DEFAULT NULL::integer, p_via_delegation boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._employee_matches_chain_step(
    p_emp_id::integer, p_step_id, p_applicant_emp_id, p_via_delegation
  );
$function$
;

-- ═══════════ _employee_matches_chain_step(p_emp_id integer, p_step_id integer, p_applicant_emp_id integer, p_via_delegation boolean) ═══════════
CREATE OR REPLACE FUNCTION public._employee_matches_chain_step(p_emp_id integer, p_step_id integer, p_applicant_emp_id integer DEFAULT NULL::integer, p_via_delegation boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_step  approval_chain_steps;
  v_emp   employees;
  v_app   employees;
  v_l1_id INT;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps WHERE id = p_step_id;
  IF v_step.id IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id AND status = '在職';
  IF v_emp.id IS NULL THEN RETURN FALSE; END IF;

  -- ★ 代簽：若 p_emp 是某人的 active 代理人，且委託人滿足此關 → 通過。
  --   p_via_delegation=TRUE 時跳過（只展開一層，防遞迴）。
  IF NOT p_via_delegation THEN
    IF EXISTS (
      SELECT 1 FROM approval_delegation_rules dr
       WHERE dr.delegate_employee_id = p_emp_id
         AND dr.is_active
         AND CURRENT_DATE >= dr.effective_from
         AND (dr.effective_to IS NULL OR CURRENT_DATE <= dr.effective_to)
         AND public._employee_matches_chain_step(
               dr.delegator_employee_id, p_step_id, p_applicant_emp_id, TRUE
             )
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  IF v_step.target_type = 'fixed_emp' THEN
    RETURN v_step.target_emp_id = p_emp_id;
  ELSIF v_step.target_type = 'fixed_role' THEN
    RETURN v_step.target_role_id = v_emp.role_id;
  ELSIF v_step.target_type = 'fixed_dept' THEN
    RETURN v_step.target_dept_id = v_emp.department_id;
  END IF;

  IF p_applicant_emp_id IS NOT NULL THEN
    SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;
  END IF;

  IF v_step.target_type = 'applicant_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN COALESCE(v_app.supervisor_id, v_app.reporting_to) = p_emp_id;
  END IF;

  -- ★ L2：申請人直屬主管的上級
  IF v_step.target_type = 'applicant_supervisor_l2' AND v_app.id IS NOT NULL THEN
    SELECT COALESCE(supervisor_id, reporting_to) INTO v_l1_id
      FROM employees WHERE id = COALESCE(v_app.supervisor_id, v_app.reporting_to);
    RETURN v_l1_id IS NOT NULL AND v_l1_id = p_emp_id;
  END IF;

  -- ★ L3：申請人直屬主管的上級的上級
  IF v_step.target_type = 'applicant_supervisor_l3' AND v_app.id IS NOT NULL THEN
    SELECT COALESCE(supervisor_id, reporting_to) INTO v_l1_id
      FROM employees WHERE id = COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_l1_id IS NULL THEN RETURN FALSE; END IF;
    SELECT COALESCE(supervisor_id, reporting_to) INTO v_l1_id
      FROM employees WHERE id = v_l1_id;
    RETURN v_l1_id IS NOT NULL AND v_l1_id = p_emp_id;
  END IF;

  IF v_step.target_type = 'applicant_dept_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_app.department_id AND d.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'applicant_store_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_app.store_id AND s.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'applicant_store_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (v_emp.store_id = v_app.store_id AND v_emp.position = '督導');
  ELSIF v_step.target_type = 'applicant_section_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (
      EXISTS (SELECT 1 FROM stores s
                JOIN department_sections ds ON ds.id = s.section_id
               WHERE s.id = v_app.store_id AND ds.supervisor_id = p_emp_id)
      OR (
        p_emp_id = v_app.id
        AND NOT EXISTS (SELECT 1 FROM stores s
                          JOIN department_sections ds ON ds.id = s.section_id
                         WHERE s.id = v_app.store_id AND ds.supervisor_id IS NOT NULL)
        AND EXISTS (SELECT 1 FROM department_sections WHERE supervisor_id = v_app.id)
      )
    );
  END IF;

  IF v_step.target_type = 'specific_dept_manager' THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_step.target_dept_id AND d.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'specific_store_manager' THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_step.target_store_id AND s.manager_id = p_emp_id);
  ELSIF v_step.target_type = 'specific_section_supervisor' THEN
    RETURN EXISTS (SELECT 1 FROM department_sections ds
                    WHERE ds.id = v_step.target_section_id AND ds.supervisor_id = p_emp_id);
  END IF;

  RETURN FALSE;
END $function$
;

-- ═══════════ _employee_matches_snapshot_step(p_emp_id integer, p_request_type text, p_request_id integer, p_step_order integer, p_applicant_emp_id integer) ═══════════
CREATE OR REPLACE FUNCTION public._employee_matches_snapshot_step(p_emp_id integer, p_request_type text, p_request_id integer, p_step_order integer, p_applicant_emp_id integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_snap  public.request_chain_snapshots;
  v_emp   employees;
  v_app   employees;
  v_l1_id INT;
BEGIN
  SELECT * INTO v_snap
    FROM public.request_chain_snapshots
   WHERE request_type = p_request_type
     AND request_id   = p_request_id
     AND step_order   = p_step_order;
  IF v_snap.id IS NULL THEN RETURN FALSE; END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id AND status = '在職';
  IF v_emp.id IS NULL THEN RETURN FALSE; END IF;

  IF v_snap.target_type = 'fixed_emp'  THEN RETURN v_snap.target_emp_id  = p_emp_id; END IF;
  IF v_snap.target_type = 'fixed_role' THEN RETURN v_snap.target_role_id = v_emp.role_id; END IF;
  IF v_snap.target_type = 'fixed_dept' THEN RETURN v_snap.target_dept_id = v_emp.department_id; END IF;

  IF p_applicant_emp_id IS NOT NULL THEN
    SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;
  END IF;

  IF v_snap.target_type = 'applicant_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN COALESCE(v_app.supervisor_id, v_app.reporting_to) = p_emp_id;
  END IF;

  -- ★ L2
  IF v_snap.target_type = 'applicant_supervisor_l2' AND v_app.id IS NOT NULL THEN
    SELECT COALESCE(supervisor_id, reporting_to) INTO v_l1_id
      FROM employees WHERE id = COALESCE(v_app.supervisor_id, v_app.reporting_to);
    RETURN v_l1_id IS NOT NULL AND v_l1_id = p_emp_id;
  END IF;

  -- ★ L3
  IF v_snap.target_type = 'applicant_supervisor_l3' AND v_app.id IS NOT NULL THEN
    SELECT COALESCE(supervisor_id, reporting_to) INTO v_l1_id
      FROM employees WHERE id = COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_l1_id IS NULL THEN RETURN FALSE; END IF;
    SELECT COALESCE(supervisor_id, reporting_to) INTO v_l1_id
      FROM employees WHERE id = v_l1_id;
    RETURN v_l1_id IS NOT NULL AND v_l1_id = p_emp_id;
  END IF;

  IF v_snap.target_type = 'applicant_dept_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_app.department_id AND d.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'applicant_store_manager' AND v_app.id IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_app.store_id AND s.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'applicant_store_supervisor' AND v_app.id IS NOT NULL THEN
    RETURN (v_emp.store_id = v_app.store_id AND v_emp.position = '督導');
  END IF;

  IF v_snap.target_type = 'applicant_section_supervisor' AND v_app.id IS NOT NULL THEN
    -- self-fallback（20260612190000）
    RETURN (
      EXISTS (SELECT 1 FROM stores s
                JOIN department_sections ds ON ds.id = s.section_id
               WHERE s.id = v_app.store_id AND ds.supervisor_id = p_emp_id)
      OR (
        p_emp_id = v_app.id
        AND NOT EXISTS (SELECT 1 FROM stores s
                          JOIN department_sections ds ON ds.id = s.section_id
                         WHERE s.id = v_app.store_id AND ds.supervisor_id IS NOT NULL)
        AND EXISTS (SELECT 1 FROM department_sections WHERE supervisor_id = v_app.id)
      )
    );
  END IF;

  IF v_snap.target_type = 'specific_dept_manager' THEN
    RETURN EXISTS (SELECT 1 FROM departments d
                    WHERE d.id = v_snap.target_dept_id AND d.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'specific_store_manager' THEN
    RETURN EXISTS (SELECT 1 FROM stores s
                    WHERE s.id = v_snap.target_store_id AND s.manager_id = p_emp_id);
  END IF;

  IF v_snap.target_type = 'specific_section_supervisor' THEN
    RETURN EXISTS (SELECT 1 FROM department_sections ds
                    WHERE ds.id = v_snap.target_section_id AND ds.supervisor_id = p_emp_id);
  END IF;

  RETURN FALSE;
END $function$
;

-- ═══════════ can_manage_bank() ═══════════
CREATE OR REPLACE FUNCTION public.can_manage_bank()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT current_employee_role() IN ('admin','super_admin')
      OR public.current_user_can('salary.pay')
$function$
;

-- ═══════════ cashout_annual_leave(p_org integer, p_year integer, p_dry_run boolean) ═══════════
CREATE OR REPLACE FUNCTION public.cashout_annual_leave(p_org integer, p_year integer, p_dry_run boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items json;
  v_count INT     := 0;
  v_total numeric := 0;
  r       RECORD;
BEGIN
  -- 權限 guard：結清會寫入獎金 + 改餘額（錢），且本函式 SECURITY DEFINER 繞 RLS，
  -- 故必須在此擋權限，否則任何 authenticated 直接打 RPC 就能結清全公司特休（提權）。
  -- 白名單 = HR 行政層；store_staff / 無員工身分一律擋。dry_run 也擋（金額也敏感）。
  IF COALESCE(public.current_employee_role(), '') NOT IN ('admin','super_admin','manager','office_staff') THEN
    RAISE EXCEPTION '無權限執行特休結清';
  END IF;

  -- ── 候選明細（特休 + 該年 + 該 org + 尚有剩餘；範圍 1:1 對齊舊前端 openCashout）──
  -- 永遠先算一次（dry_run 與實寫共用同一份 WHERE，確保預覽=實寫範圍）
  SELECT
    COALESCE(json_agg(json_build_object(
      'employee_id', t.employee_id,
      'name',        t.name,
      'balance_id',  t.balance_id,
      'unused_days', t.unused,
      'daily_rate',  t.daily_rate,
      'amount',      t.amount
    ) ORDER BY t.name), '[]'::json),
    COUNT(*),
    COALESCE(SUM(t.amount), 0)
  INTO v_items, v_count, v_total
  FROM (
    SELECT
      lb.id   AS balance_id,
      e.id    AS employee_id,
      e.name,
      (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0)) AS unused,
      (COALESCE(e.base_salary,0) / 30.0) AS daily_rate,
      round(
        (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0))
        * (COALESCE(e.base_salary,0) / 30.0)
      ) AS amount
    FROM leave_balances lb
    JOIN employees e ON e.id = lb.employee_id
    WHERE lb.leave_type = '特休'
      AND lb.year       = p_year
      AND lb.organization_id = p_org
      AND (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0)) > 0
  ) t;

  -- ── 實寫（單一 function = 單一 transaction，任一筆 raise 全回滾）──
  IF NOT p_dry_run THEN
    FOR r IN
      SELECT
        lb.id AS balance_id,
        e.id  AS employee_id,
        (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0)) AS new_used,
        round(
          (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0))
          * (COALESCE(e.base_salary,0) / 30.0)
        ) AS amount
      FROM leave_balances lb
      JOIN employees e ON e.id = lb.employee_id
      WHERE lb.leave_type = '特休'
        AND lb.year       = p_year
        AND e.status      = '在職'
        AND e.organization_id = p_org
        AND (COALESCE(lb.total_days,0) + COALESCE(lb.carry_over_days,0) - COALESCE(lb.used_days,0)) > 0
    LOOP
      INSERT INTO bonus_records(employee_id, category, amount, note, date, organization_id)
      VALUES (r.employee_id, '特休結清', r.amount, '特休結清 ' || p_year, current_date, p_org);

      UPDATE leave_balances SET used_days = r.new_used WHERE id = r.balance_id;
    END LOOP;
  END IF;

  RETURN json_build_object(
    'dry_run',         p_dry_run,
    'processed_count', v_count,
    'total_amount',    v_total,
    'items',           v_items
  );
END $function$
;

-- ═══════════ classify_overtime_category_v2(p_date date, p_employee_id integer) ═══════════
CREATE OR REPLACE FUNCTION public.classify_overtime_category_v2(p_date date, p_employee_id integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_is_holiday   BOOLEAN;
  v_shift        TEXT;
  v_dow          INT;
  v_emp_category TEXT;
BEGIN
  IF p_date IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1. 國定假日（月曆）最高優先，對所有人一律 holiday
  SELECT EXISTS (
    SELECT 1 FROM public.holidays
    WHERE date = p_date AND COALESCE(is_workday, false) = false
  ) INTO v_is_holiday;
  IF v_is_holiday THEN
    RETURN 'holiday';
  END IF;

  -- 2. 看員工該日排班 shift（明確標示優先）
  IF p_employee_id IS NOT NULL THEN
    SELECT s.shift INTO v_shift
      FROM public.schedules s
      JOIN public.employees e ON e.name = s.employee
     WHERE e.id = p_employee_id
       AND s.date = p_date
     LIMIT 1;

    IF v_shift = '國定假' THEN
      RETURN 'holiday';
    ELSIF v_shift = '例假' THEN
      RETURN 'weekly_off';
    ELSIF v_shift IN ('休', '休息') THEN
      RETURN 'restday';
    END IF;

    -- 員工類型：只有「行政(admin)」固定週一~五，才用 DOW 推休息日/例假
    SELECT ss.employment_category INTO v_emp_category
      FROM public.salary_structures ss
     WHERE ss.employee_id = p_employee_id
     LIMIT 1;
  END IF;

  -- 3. 行政 → DOW fallback；門市正職/PT(四週變形)沒班表休息標示 → 一律 weekday
  IF COALESCE(v_emp_category, '') = 'admin' THEN
    v_dow := EXTRACT(DOW FROM p_date)::INT;
    IF v_dow = 0 THEN
      RETURN 'weekly_off';
    ELSIF v_dow = 6 THEN
      RETURN 'restday';
    END IF;
  END IF;

  RETURN 'weekday';
END $function$
;

-- ═══════════ current_user_can(p_code text) ═══════════
CREATE OR REPLACE FUNCTION public.current_user_can(p_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me employees; v_eff boolean;
BEGIN
  SELECT * INTO me FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF me.id IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM roles r WHERE r.id = me.role_id AND r.name = 'super_admin') THEN
    RETURN true;
  END IF;
  SELECT CASE
    WHEN ep.mode = 'grant'      THEN true
    WHEN ep.mode = 'revoke'     THEN false
    WHEN rp.role_id IS NOT NULL THEN true
    ELSE false
  END
  INTO v_eff
  FROM permissions p
  LEFT JOIN role_permissions rp     ON rp.permission_id = p.id AND rp.role_id = me.role_id
  LEFT JOIN employee_permissions ep ON ep.permission_id = p.id AND ep.employee_id = me.id
  WHERE p.code = p_code
  LIMIT 1;
  RETURN COALESCE(v_eff, false);
END $function$
;

-- ═══════════ enforce_payroll_requires_locked_schedule() ═══════════
CREATE OR REPLACE FUNCTION public.enforce_payroll_requires_locked_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store_id   INT;
  v_store_name TEXT;
BEGIN
  SELECT e.store_id INTO v_store_id FROM employees e WHERE e.id = NEW.employee_id;

  -- 沒門市（固定行政工時，無變動班表可鎖）→ 放行
  IF v_store_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 有門市 → 該月班表必須已鎖定
  IF NOT EXISTS (
    SELECT 1 FROM schedule_month_locks l
    WHERE l.store_id = v_store_id
      AND l.month = NEW.pay_period
  ) THEN
    SELECT name INTO v_store_name FROM stores WHERE id = v_store_id;
    RAISE EXCEPTION '「%」% 班表尚未鎖定，無法結算薪資',
      COALESCE(v_store_name, '門市#' || v_store_id), NEW.pay_period
      USING HINT = '請先到排班頁鎖定此門市的該月份，再結算薪資';
  END IF;

  RETURN NEW;
END $function$
;

-- ═══════════ expense_request_step_advance(p_id integer, p_action text, p_reason text) ═══════════
CREATE OR REPLACE FUNCTION public.expense_request_step_advance(p_id integer, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_emp          employees;
  v_req          expense_requests;
  v_total_steps  INT;
  v_matches      boolean;
  v_extra        approval_extra_steps;
  v_has_snapshot boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = p_id;
  IF v_req.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_req.status NOT IN ('申請中', '待審') THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING', 'current_status', v_req.status);
  END IF;

  -- 加簽 guard
  v_extra := public.get_pending_extra_step('expense_requests', p_id, COALESCE(v_req.current_step, 0));
  IF v_extra.id IS NOT NULL THEN
    RETURN json_build_object(
      'ok', false, 'error', 'PENDING_EXTRA_SIGNER',
      'extra_step_id', v_extra.id,
      'extra_assignee_id', v_extra.assignee_id,
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
    );
  END IF;

  -- 沒綁 chain → 舊行為
  IF v_req.approval_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      UPDATE expense_requests SET
        status = '已核准', approved_by = v_emp.name, approved_at = NOW()
      WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'fully_approved', true);
    ELSE
      UPDATE expense_requests SET
        status = '已駁回', reject_reason = p_reason,
        approved_by = v_emp.name, approved_at = NOW()
      WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回');
    END IF;
  END IF;

  -- ── 讀快照（優先）or live chain（fallback）──
  SELECT EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = 'expense_request' AND request_id = p_id
  ) INTO v_has_snapshot;

  IF v_has_snapshot THEN
    -- 確認 current step 在快照裡存在
    IF NOT EXISTS (
      SELECT 1 FROM public.request_chain_snapshots
       WHERE request_type = 'expense_request' AND request_id = p_id
         AND step_order = v_req.current_step
    ) THEN
      RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND',
        'current_step', v_req.current_step, 'source', 'snapshot');
    END IF;

    -- 比對：此人是否為當前關的 approver
    SELECT public._employee_matches_snapshot_step(
      v_emp.id, 'expense_request', p_id, v_req.current_step, v_req.employee_id
    ) INTO v_matches;

    -- step 總數（從快照算）
    SELECT COUNT(*) INTO v_total_steps
      FROM public.request_chain_snapshots
     WHERE request_type = 'expense_request' AND request_id = p_id;

  ELSE
    -- fallback：live chain（舊單）
    DECLARE v_step approval_chain_steps; BEGIN
      SELECT * INTO v_step FROM approval_chain_steps
       WHERE chain_id = v_req.approval_chain_id AND step_order = v_req.current_step;
      IF v_step.id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND',
          'current_step', v_req.current_step, 'source', 'live_chain');
      END IF;
      SELECT public._employee_matches_chain_step(v_emp.id, v_step.id, v_req.employee_id)
        INTO v_matches;
    END;
    SELECT COUNT(*) INTO v_total_steps
      FROM approval_chain_steps WHERE chain_id = v_req.approval_chain_id;
  END IF;

  IF NOT v_matches THEN
    RETURN json_build_object(
      'ok', false, 'error', 'NOT_AUTHORIZED_FOR_STEP',
      'current_step', v_req.current_step
    );
  END IF;

  IF p_action = 'reject' THEN
    UPDATE expense_requests SET
      status = '已駁回', reject_reason = p_reason,
      approved_by = v_emp.name, approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'rejected_at_step', v_req.current_step);
  END IF;

  -- approve：最後一關 → 核准；其他 → 推進
  IF v_req.current_step + 1 >= v_total_steps THEN
    UPDATE expense_requests SET
      status = '已核准', current_step = v_total_steps,
      approved_by = v_emp.name, approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'fully_approved', true,
                             'advanced_to_step', v_total_steps);
  ELSE
    UPDATE expense_requests SET
      current_step = current_step + 1,
      approved_by = v_emp.name
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '簽核中', 'fully_approved', false,
                             'advanced_to_step', v_req.current_step + 1);
  END IF;
END $function$
;

-- ═══════════ expense_settle_step_advance(p_id integer, p_action text, p_reason text) ═══════════
CREATE OR REPLACE FUNCTION public.expense_settle_step_advance(p_id integer, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_emp           employees;
  v_req           expense_requests;
  v_total_steps   INT;
  v_step          approval_chain_steps;
  v_matches       boolean;
  v_amount        NUMERIC;
  v_pending_extra INT;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = p_id;
  IF v_req.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_req.status <> '待核銷' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING_SETTLE', 'current_status', v_req.status);
  END IF;

  v_amount := COALESCE(v_req.actual_amount, v_req.estimated_amount, 0);

  -- 有 pending 加簽時不允許推進
  SELECT id INTO v_pending_extra
  FROM approval_extra_steps
  WHERE source_table = 'expense_settles'
    AND source_id = p_id
    AND insert_before_step = v_req.settle_current_step
    AND status = 'pending'
  LIMIT 1;
  IF v_pending_extra IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'PENDING_EXTRA_STEP', 'extra_step_id', v_pending_extra);
  END IF;

  -- 沒掛 settle chain → fallback：admin 一鍵 confirm
  IF v_req.settle_chain_id IS NULL THEN
    BEGIN
      PERFORM secure_create_journal_entry(
        CURRENT_DATE,
        '費用申請核銷 - ' || v_req.employee || ' (' || v_req.title || ')',
        json_build_array(
          json_build_object('account_code', v_req.account_code, 'account_name', v_req.account_name, 'debit', v_amount, 'credit', 0, 'memo', '申請單 #' || v_req.id),
          json_build_object('account_code', '1100', 'account_name', '現金', 'debit', 0, 'credit', v_amount, 'memo', '')
        )::jsonb,
        '費用申請', v_req.id, v_emp.name
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    UPDATE expense_requests SET status = '已核銷', settled_by = v_emp.name, settled_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核銷', 'fully_settled', true, 'fallback', true);
  END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_req.settle_chain_id AND step_order = v_req.settle_current_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND', 'current_step', v_req.settle_current_step);
  END IF;

  -- ★ 修正：補上申請人 id（第 3 參數），動態 target（部門主管/店督導）才解得出簽核人
  SELECT _employee_matches_chain_step(v_emp.id, v_step.id, v_req.employee_id) INTO v_matches;
  IF NOT v_matches THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED_FOR_STEP',
                             'current_step', v_req.settle_current_step);
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps
   WHERE chain_id = v_req.settle_chain_id;

  IF p_action = 'reject' THEN
    UPDATE expense_requests SET status = '核銷已退回', settle_reject_reason = p_reason WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '核銷已退回', 'rejected_at_step', v_req.settle_current_step);
  END IF;

  IF v_req.settle_current_step + 1 >= v_total_steps THEN
    BEGIN
      PERFORM secure_create_journal_entry(
        CURRENT_DATE,
        '費用申請核銷 - ' || v_req.employee || ' (' || v_req.title || ')',
        json_build_array(
          json_build_object('account_code', v_req.account_code, 'account_name', v_req.account_name, 'debit', v_amount, 'credit', 0, 'memo', '申請單 #' || v_req.id),
          json_build_object('account_code', '1100', 'account_name', '現金', 'debit', 0, 'credit', v_amount, 'memo', '')
        )::jsonb,
        '費用申請', v_req.id, v_emp.name
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    UPDATE expense_requests SET status = '已核銷', settle_current_step = v_total_steps,
      settled_by = v_emp.name, settled_at = NOW() WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核銷', 'fully_settled', true,
                             'advanced_to_step', v_total_steps);
  ELSE
    UPDATE expense_requests SET settle_current_step = settle_current_step + 1 WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '核銷中', 'fully_settled', false,
                             'advanced_to_step', v_req.settle_current_step + 1);
  END IF;
END $function$
;

-- ═══════════ form_submission_chain_approve(p_id integer, p_approver_id integer, p_action text, p_reason text, p_reject_attachments jsonb) ═══════════
CREATE OR REPLACE FUNCTION public.form_submission_chain_approve(p_id integer, p_approver_id integer, p_action text, p_reason text DEFAULT NULL::text, p_reject_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub             form_submissions;
  v_template        form_templates;
  v_chain_id        INT;
  v_has_snapshot    BOOLEAN;
  v_snap            request_chain_snapshots;
  v_step            approval_chain_steps;
  v_matches         BOOLEAN;
  v_total_steps     INT;
  v_is_last         BOOLEAN;
  v_next_label      TEXT;
  v_new_current     INT;
BEGIN
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_sub FROM form_submissions
   WHERE id = p_id AND deleted_at IS NULL;
  IF v_sub.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_sub.status <> '申請中' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  SELECT * INTO v_template FROM form_templates WHERE id = v_sub.template_id;
  v_chain_id := v_template.approval_chain_id;

  -- 沒綁 chain → 維持舊行為（直接核准/駁回）
  IF v_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      UPDATE form_submissions
         SET status = '已核准', approver_id = p_approver_id, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved_no_chain');
    ELSE
      UPDATE form_submissions
         SET status = '已駁回',
             reject_reason = btrim(p_reason),
             reject_attachments = COALESCE(p_reject_attachments, '[]'::jsonb),
             approver_id = p_approver_id, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected_no_chain');
    END IF;
  END IF;

  -- ── 加簽 guard（不分快照/live，獨立檢查）──
  IF EXISTS (
    SELECT 1 FROM approval_extra_steps
     WHERE source_table = 'form_submissions'
       AND source_id = p_id
       AND insert_before_step = COALESCE(v_sub.current_step, 0)
       AND status = 'pending'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'PENDING_EXTRA_SIGNER',
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核');
  END IF;

  -- ── 快照優先 ──
  SELECT EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = 'form_submission' AND request_id = p_id
  ) INTO v_has_snapshot;

  IF v_has_snapshot THEN
    SELECT * INTO v_snap
      FROM public.request_chain_snapshots
     WHERE request_type = 'form_submission'
       AND request_id   = p_id
       AND step_order   = COALESCE(v_sub.current_step, 0);
    IF v_snap.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND',
        'source', 'snapshot', 'current_step', v_sub.current_step);
    END IF;

    SELECT public._employee_matches_snapshot_step(
      p_approver_id, 'form_submission', p_id,
      COALESCE(v_sub.current_step, 0), v_sub.applicant_id
    ) INTO v_matches;

    SELECT COUNT(*) INTO v_total_steps
      FROM public.request_chain_snapshots
     WHERE request_type = 'form_submission' AND request_id = p_id;

  ELSE
    -- fallback：live chain（舊單沒快照）
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = COALESCE(v_sub.current_step, 0);
    IF v_step.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND',
        'source', 'live_chain', 'current_step', v_sub.current_step);
    END IF;

    SELECT public._employee_matches_chain_step(p_approver_id, v_step.id, v_sub.applicant_id)
      INTO v_matches;

    SELECT COUNT(*) INTO v_total_steps
      FROM approval_chain_steps WHERE chain_id = v_chain_id;
  END IF;

  IF NOT v_matches THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  -- ── reject ──
  IF p_action = 'reject' THEN
    UPDATE form_submissions
       SET status = '已駁回',
           reject_reason = btrim(p_reason),
           reject_attachments = COALESCE(p_reject_attachments, '[]'::jsonb),
           approver_id = p_approver_id, approved_at = NOW()
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected',
      'rejected_at_step', v_sub.current_step);
  END IF;

  -- ── approve ──
  v_new_current := COALESCE(v_sub.current_step, 0) + 1;
  v_is_last     := (v_new_current >= v_total_steps);

  IF v_is_last THEN
    UPDATE form_submissions
       SET status = '已核准', approver_id = p_approver_id, approved_at = NOW(),
           current_step = v_total_steps - 1
     WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved', 'is_last_step', true);
  ELSE
    UPDATE form_submissions SET current_step = v_new_current WHERE id = p_id;

    -- 下一關 label（快照優先）
    IF v_has_snapshot THEN
      SELECT COALESCE(label, role_name) INTO v_next_label
        FROM public.request_chain_snapshots
       WHERE request_type = 'form_submission' AND request_id = p_id
         AND step_order = v_new_current;
    ELSE
      SELECT COALESCE(label, role_name) INTO v_next_label
        FROM approval_chain_steps
       WHERE chain_id = v_chain_id AND step_order = v_new_current;
    END IF;

    RETURN json_build_object(
      'ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', v_new_current, 'is_last_step', false,
      'next_step_label', v_next_label
    );
  END IF;
END $function$
;

-- ═══════════ generate_payroll(p_pay_period character, p_created_by integer) ═══════════
CREATE OR REPLACE FUNCTION public.generate_payroll(p_pay_period character, p_created_by integer DEFAULT NULL::integer)
 RETURNS TABLE(payroll_run_id integer, records_created integer)
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
    WHERE (e.in_payroll IS NOT FALSE)             -- 編制外員工不納入薪資計算
      AND (e.join_date IS NULL OR e.join_date <= v_month_end)
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

      v_income_tax := 0;  -- 所得稅不代扣（老闆政策 2026-06-25）

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
$function$
;

-- ═══════════ get_expense_request_chain_full(p_id integer, p_applicant_emp_id integer) ═══════════
CREATE OR REPLACE FUNCTION public.get_expense_request_chain_full(p_id integer, p_applicant_emp_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req            expense_requests;
  v_app_id         INT;
  v_status_eff     TEXT;              -- 主鏈用：待核銷→已核准（其餘照舊）
  v_chain          json;             -- 主鏈步驟（building block 解析過 names）
  v_timeline       json;             -- 主鏈 timeline
  v_total          INT;
  v_cur            INT;
  v_main           json := '[]'::json;
  v_sup            jsonb;
  -- 核銷
  v_in_settle      boolean;
  v_is_settled     boolean;
  v_settle_cur     INT;
  v_settle_tl      json;
  v_settle_chain   json;
  v_has_settle_snap boolean;
  v_settle_steps   json := '[]'::json;
  v_settle_start   TIMESTAMPTZ;
  v_interval       TEXT;
  v_diff           BIGINT;
  v_final          jsonb;
BEGIN
  SELECT * INTO v_req FROM expense_requests WHERE id = p_id;
  IF v_req.id IS NULL THEN RETURN '[]'::json; END IF;

  v_app_id     := COALESCE(p_applicant_emp_id, v_req.employee_id);
  v_status_eff := CASE WHEN v_req.status = '待核銷' THEN '已核准' ELSE v_req.status END;

  -- ════════════════════════════════════════════════════════════════════════
  -- 1) 主鏈 baseSteps
  -- ════════════════════════════════════════════════════════════════════════
  IF v_req.approval_chain_id IS NULL THEN
    -- ── 無 chain fallback（buildChainBasedSteps 133-141）──
    IF v_status_eff IN ('已核准','已核銷') THEN
      v_sup := jsonb_build_object('label','主管核示','name',COALESCE(v_req.approved_by,''),
                                  'status','completed','completedAt', v_req.approved_at);
    ELSIF v_status_eff IN ('已駁回','已拒絕','已退回') THEN
      v_sup := jsonb_build_object('label','主管核示','name',COALESCE(v_req.approved_by,''),
                                  'status','rejected','rejectReason', v_req.reject_reason);
    ELSE
      v_sup := jsonb_build_object('label','主管核示','name','','status','current');
    END IF;

    v_main := (jsonb_build_array(
      jsonb_build_object('label','申請人','name',COALESCE(v_req.employee,'—'),
                         'status','completed','completedAt', v_req.created_at, 'isApplicant', true),
      v_sup
    ))::json;

  ELSE
    -- ── 有 chain：snapshot 優先，fallback live（buildChainBasedSteps 161-203）──
    v_chain := public.get_request_chain_display_names('expense_request', p_id, v_app_id);
    IF v_chain IS NULL OR json_array_length(v_chain) = 0 THEN
      v_chain := public.get_chain_step_display_names(v_req.approval_chain_id, v_app_id);
    END IF;
    IF v_chain IS NULL THEN v_chain := '[]'::json; END IF;

    v_total := json_array_length(v_chain);
    v_cur   := COALESCE(v_req.current_step, 0);
    IF v_cur < 0 THEN v_cur := 0;
    ELSIF v_cur > v_total + 1 THEN v_cur := v_total + 1; END IF;     -- clamp（buildChainBasedSteps 208-215）

    v_timeline := public.get_approval_timeline('expense_request', p_id);

    -- 申請人 cell + chain steps + 加簽 step，用 sort_key 排序（mergeExtraSteps 324-339）
    SELECT COALESCE(json_agg(obj ORDER BY sort_key, seq), '[]'::json)
      INTO v_main
    FROM (
      -- 申請人（order -1）
      SELECT (-1)::numeric AS sort_key, 0 AS seq,
        jsonb_build_object('label','申請人','name',COALESCE(v_req.employee,'—'),
                           'status','completed','completedAt', v_req.created_at, 'isApplicant', true) AS obj

      UNION ALL

      -- chain steps（order = step_order）
      SELECT cs.step_order::numeric, 0,
        jsonb_build_object(
          'label',         cs.label,
          'name',          cs.target_name,
          'target_emp_id', cs.target_emp_id,
          'role_name',     cs.role_name,
          'status',        cs.status,
          'completedAt',   cs.completed_at,
          'completedBy',   CASE WHEN cs.status = 'completed' THEN cs.target_name ELSE NULL END,
          'rejectReason',  CASE WHEN cs.status = 'rejected' THEN v_req.reject_reason ELSE '' END,
          'durationText',  cs.duration_text
        )
      FROM (
        SELECT
          c.step_order, c.label, c.role_name, c.target_emp_id, c.target_name, c.status,
          -- timeline 覆蓋（openDetail 443-452）：exited_at 有 + status completed/rejected
          CASE WHEN tl.exited_at IS NOT NULL AND c.status IN ('completed','rejected')
               THEN tl.duration_text ELSE NULL END AS duration_text,
          CASE WHEN tl.exited_at IS NOT NULL AND c.status IN ('completed','rejected')
               THEN tl.exited_at
               WHEN c.status = 'completed' AND c.step_order = v_total - 1
               THEN v_req.approved_at
               ELSE NULL END AS completed_at
        FROM (
          SELECT
            (e->>'step_order')::int AS step_order,
            e->>'label'             AS label,
            e->>'role_name'         AS role_name,
            NULLIF(e->>'target_emp_id','')::int AS target_emp_id,
            -- targetName = names || (target_emp_id ? approverMap : role_name)（buildChainBasedSteps 226）
            COALESCE(
              NULLIF(e->>'names',''),
              CASE WHEN NULLIF(e->>'target_emp_id','') IS NOT NULL
                   THEN COALESCE(emp.name,'') ELSE COALESCE(e->>'role_name','') END
            ) AS target_name,
            -- 狀態（buildChainBasedSteps 219-225）
            CASE
              WHEN v_status_eff IN ('已駁回','已拒絕','已退回') THEN
                CASE WHEN (e->>'step_order')::int = v_cur THEN 'rejected'
                     WHEN (e->>'step_order')::int < v_cur THEN 'completed'
                     ELSE 'pending' END
              WHEN v_status_eff IN ('已核准','已核銷') THEN 'completed'
              ELSE
                CASE WHEN (e->>'step_order')::int < v_cur THEN 'completed'
                     WHEN (e->>'step_order')::int = v_cur THEN 'current'
                     ELSE 'pending' END
            END AS status
          FROM json_array_elements(v_chain) e
          -- approverMap fallback：舊前端的 approverMap 是用「現行 chain」的 target_emp_id 建的，
          -- 故名字只能在現行 chain 的 target_emp_id 範圍內 resolve（快照若指向已不在現行 chain
          -- 的人，舊前端顯示空白——這裡忠實複製，見 openDetail 392-403）
          LEFT JOIN employees emp
            ON emp.id = NULLIF(e->>'target_emp_id','')::int
           AND emp.id IN (SELECT acs.target_emp_id FROM approval_chain_steps acs
                           WHERE acs.chain_id = v_req.approval_chain_id
                             AND acs.target_emp_id IS NOT NULL)
        ) c
        LEFT JOIN LATERAL (
          -- 同 step_order 可能多筆（駁回後重簽，甚至 entered_at 並列只差 exited_at）；
          -- 舊前端用 tlByStep[so]=t 依陣列順序覆蓋 → 取陣列「最後一筆」（用 ordinality 復刻，
          -- 比 entered_at 排序穩，因為並列時 entered_at 分不出先後）
          SELECT (te.elem->>'exited_at')::timestamptz AS exited_at,
                 te.elem->>'duration_text' AS duration_text
          FROM json_array_elements(v_timeline) WITH ORDINALITY AS te(elem, ord)
          WHERE (te.elem->>'step_order')::int = c.step_order
          ORDER BY te.ord DESC
          LIMIT 1
        ) tl ON true
      ) cs

      UNION ALL

      -- 加簽 step（order = insert_before_step - 0.5）（mergeExtraSteps 294-319）
      SELECT (x.insert_before_step - 0.5)::numeric, x.seq,
        jsonb_build_object(
          'kind',               'extra',
          'label',              '加簽',
          'name',               COALESCE(asg.name,''),
          'status',             CASE x.status WHEN 'pending'  THEN 'current'
                                              WHEN 'approved' THEN 'completed'
                                              WHEN 'rejected' THEN 'rejected'
                                              ELSE 'pending' END,
          'completedAt',        x.approved_at,
          'completedBy',        COALESCE(asg.name,''),
          'durationText',       public._fmt_duration_zh(x.created_at, x.approved_at),
          'rejectReason',       COALESCE(x.reject_reason,''),
          'extraReason',        COALESCE(x.reason,''),
          'extraRequesterName', COALESCE(rb.name,'')
        )
      FROM (
        SELECT *, row_number() OVER (ORDER BY created_at) AS seq
        FROM approval_extra_steps
        WHERE source_table = 'expense_requests' AND source_id = p_id
          AND status <> 'cancelled'
      ) x
      LEFT JOIN employees asg ON asg.id = x.assignee_id
      LEFT JOIN employees rb  ON rb.id  = x.requested_by_id
    ) q;
  END IF;

  -- ════════════════════════════════════════════════════════════════════════
  -- 2) 核銷階段（openDetail 457-581）
  -- ════════════════════════════════════════════════════════════════════════
  v_in_settle  := v_req.status IN ('待核銷','已核銷');
  v_is_settled := v_req.status = '已核銷';

  IF NOT v_in_settle THEN
    v_final := v_main::jsonb;

  ELSIF v_req.settle_chain_id IS NULL THEN
    -- 無核銷鏈 → 單關「財務核章」佔位（openDetail 570-580）
    v_final := v_main::jsonb || jsonb_build_array(
      jsonb_build_object(
        'label',       '財務核章',
        'name',        CASE WHEN v_is_settled THEN COALESCE(NULLIF(v_req.settled_by,''),'') ELSE '' END,
        'status',      CASE WHEN v_is_settled THEN 'completed' ELSE 'current' END,
        'completedAt', CASE WHEN v_is_settled THEN v_req.settled_at ELSE NULL END,
        'archival',    false,
        'isSettle',    true
      )
    );

  ELSE
    -- 有核銷鏈：snapshot（request_type='expense_settle'）優先，fallback live
    v_settle_cur := COALESCE(v_req.settle_current_step, 0);
    v_settle_tl  := public.get_approval_timeline('expense_settle', p_id);

    -- settleStartAt：snapshot 的 created_at 欄不存在（live 表是 snapshotted_at），
    -- 故舊前端該查必失敗 → 一律 fallback timeline step 0 entered_at（openDetail 547）
    SELECT t.entered_at INTO v_settle_start
    FROM json_to_recordset(v_settle_tl) AS t(step_order int, entered_at timestamptz)
    WHERE t.step_order = 0 LIMIT 1;

    -- 「核准後 N 天/小時/分鐘送核銷(驗收)」（openDetail 548-554）
    IF v_settle_start IS NOT NULL AND v_req.approved_at IS NOT NULL THEN
      v_diff := floor(EXTRACT(EPOCH FROM (v_settle_start - v_req.approved_at)))::BIGINT;
      v_interval := CASE
        WHEN v_diff < 3600  THEN '核准後 ' || (v_diff / 60)    || ' 分鐘送核銷(驗收)'
        WHEN v_diff < 86400 THEN '核准後 ' || (v_diff / 3600)  || ' 小時送核銷(驗收)'
        ELSE                     '核准後 ' || (v_diff / 86400) || ' 天送核銷(驗收)'
      END;
    ELSE
      v_interval := NULL;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM request_chain_snapshots
      WHERE request_type = 'expense_settle' AND request_id = p_id
    ) INTO v_has_settle_snap;

    IF v_has_settle_snap THEN
      -- 快照路徑：直接讀 request_chain_snapshots，names 只用 target_emp_id→name
      -- （openDetail 463-481，刻意不解動態 target，與舊前端一致）
      SELECT COALESCE(json_agg(
        jsonb_build_object(
          'label',  src.display_label,
          'name',   CASE WHEN v_is_settled AND src.step_order = src.total - 1
                         THEN COALESCE(NULLIF(v_req.settled_by,''), src.emp_name)
                         ELSE src.emp_name END,
          'status', src.status,
          'completedAt', CASE
            WHEN stl.exited_at IS NOT NULL AND src.status = 'completed'
            THEN COALESCE(CASE WHEN v_is_settled AND src.step_order = src.total - 1
                               THEN v_req.settled_at END, stl.exited_at)
            ELSE CASE WHEN v_is_settled AND src.step_order = src.total - 1
                      THEN v_req.settled_at END END,
          'durationText', CASE WHEN stl.exited_at IS NOT NULL AND src.status = 'completed'
                               THEN stl.duration_text ELSE NULL END,
          'archival', false,
          'isSettle', true
        ) ORDER BY src.step_order
      ), '[]'::json)
      INTO v_settle_steps
      FROM (
        SELECT
          s.step_order,
          COALESCE(NULLIF(s.label,''), NULLIF(s.role_name,''),
                   '核銷第 ' || (s.step_order + 1) || ' 關') AS display_label,
          CASE WHEN s.target_emp_id IS NOT NULL THEN COALESCE(emp.name,'')
               ELSE COALESCE(NULLIF(s.role_name,''), NULLIF(s.label,''), '') END AS emp_name,
          CASE WHEN v_is_settled THEN 'completed'
               WHEN s.step_order < v_settle_cur THEN 'completed'
               WHEN s.step_order = v_settle_cur THEN 'current'
               ELSE 'pending' END AS status,
          count(*) OVER () AS total
        FROM request_chain_snapshots s
        LEFT JOIN employees emp ON emp.id = s.target_emp_id
        WHERE s.request_type = 'expense_settle' AND s.request_id = p_id
      ) src
      LEFT JOIN LATERAL (
        SELECT (te.elem->>'exited_at')::timestamptz AS exited_at,
               te.elem->>'duration_text' AS duration_text
        FROM json_array_elements(v_settle_tl) WITH ORDINALITY AS te(elem, ord)
        WHERE (te.elem->>'step_order')::int = src.step_order ORDER BY te.ord DESC LIMIT 1
      ) stl ON true;

    ELSE
      -- live 路徑：get_chain_step_display_names（已解動態 names）（openDetail 482-489）
      v_settle_chain := public.get_chain_step_display_names(v_req.settle_chain_id, v_app_id);
      IF v_settle_chain IS NULL THEN v_settle_chain := '[]'::json; END IF;

      SELECT COALESCE(json_agg(
        jsonb_build_object(
          'label',  src.display_label,
          'name',   CASE WHEN v_is_settled AND src.step_order = src.total - 1
                         THEN COALESCE(NULLIF(v_req.settled_by,''), src.emp_name)
                         ELSE src.emp_name END,
          'status', src.status,
          'completedAt', CASE
            WHEN stl.exited_at IS NOT NULL AND src.status = 'completed'
            THEN COALESCE(CASE WHEN v_is_settled AND src.step_order = src.total - 1
                               THEN v_req.settled_at END, stl.exited_at)
            ELSE CASE WHEN v_is_settled AND src.step_order = src.total - 1
                      THEN v_req.settled_at END END,
          'durationText', CASE WHEN stl.exited_at IS NOT NULL AND src.status = 'completed'
                               THEN stl.duration_text ELSE NULL END,
          'archival', false,
          'isSettle', true
        ) ORDER BY src.step_order
      ), '[]'::json)
      INTO v_settle_steps
      FROM (
        SELECT
          (e->>'step_order')::int AS step_order,
          COALESCE(NULLIF(e->>'label',''), NULLIF(e->>'role_name',''),
                   '核銷第 ' || ((e->>'step_order')::int + 1) || ' 關') AS display_label,
          COALESCE(e->>'names','') AS emp_name,
          CASE WHEN v_is_settled THEN 'completed'
               WHEN (e->>'step_order')::int < v_settle_cur THEN 'completed'
               WHEN (e->>'step_order')::int = v_settle_cur THEN 'current'
               ELSE 'pending' END AS status,
          json_array_length(v_settle_chain) AS total
        FROM json_array_elements(v_settle_chain) e
      ) src
      LEFT JOIN LATERAL (
        SELECT (te.elem->>'exited_at')::timestamptz AS exited_at,
               te.elem->>'duration_text' AS duration_text
        FROM json_array_elements(v_settle_tl) WITH ORDINALITY AS te(elem, ord)
        WHERE (te.elem->>'step_order')::int = src.step_order ORDER BY te.ord DESC LIMIT 1
      ) stl ON true;
    END IF;

    -- baseSteps + 核銷分隔 + 核銷申請人 + 核銷各關（openDetail 564-569）
    v_final := v_main::jsonb
      || jsonb_build_array(
           jsonb_build_object('kind','settle_divider'),
           jsonb_build_object(
             'label','申請人（送核銷/驗收）',
             'name', v_req.employee,
             'status','completed',
             'completedAt', v_settle_start,
             'noteText', v_interval,
             'isSettle', true,
             'isApplicant', true
           )
         )
      || v_settle_steps::jsonb;
  END IF;

  RETURN COALESCE(v_final, '[]'::jsonb)::json;
END $function$
;

-- ═══════════ get_hr_dashboard(p_org integer, p_leave_warn integer, p_leave_crit integer, p_permit_warn integer, p_permit_crit integer, p_probation_warn integer) ═══════════
CREATE OR REPLACE FUNCTION public.get_hr_dashboard(p_org integer, p_leave_warn integer DEFAULT 30, p_leave_crit integer DEFAULT 14, p_permit_warn integer DEFAULT 60, p_permit_crit integer DEFAULT 30, p_probation_warn integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org       INT  := current_employee_org();
  v_today     date := current_date;
  v_leave     jsonb;
  v_permit    jsonb;
  v_prob      jsonb;
  v_salary    jsonb := NULL;
  v_cur_month text;
  v_prev_month text;
BEGIN
  IF p_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'FORBIDDEN: 不可存取其他組織資料';
  END IF;

  -- 特休到期風險（annual；剩餘 = total + carry_over - used > 0；未來 warn 天內到期）
  WITH lb AS (
    SELECT b.employee_id, e.name,
           (COALESCE(b.total_days,0) + COALESCE(b.carry_over_days,0) - COALESCE(b.used_days,0)) AS rem,
           b.expires_at
    FROM leave_balances b
    JOIN employees e ON e.id = b.employee_id AND e.status = '在職'
    WHERE b.organization_id = p_org
      AND b.leave_type = 'annual'
      AND b.expires_at IS NOT NULL
      AND b.expires_at >= v_today
      AND b.expires_at <= v_today + p_leave_warn
      AND (COALESCE(b.total_days,0) + COALESCE(b.carry_over_days,0) - COALESCE(b.used_days,0)) > 0
  )
  SELECT jsonb_build_object(
    'people',     COUNT(DISTINCT employee_id),
    'crit',       COUNT(DISTINCT employee_id) FILTER (WHERE expires_at <= v_today + p_leave_crit),
    'total_days', COALESCE(ROUND(SUM(rem), 1), 0),
    'list',       COALESCE(jsonb_agg(jsonb_build_object(
                    'name', name, 'days', ROUND(rem, 1), 'expires_at', expires_at
                  ) ORDER BY expires_at), '[]'::jsonb)
  ) INTO v_leave FROM lb;

  -- 外籍工作證到期（warn 天內）
  WITH wp AS (
    SELECT name, work_permit_expiry AS exp
    FROM employees
    WHERE organization_id = p_org AND status = '在職'
      AND work_permit_expiry IS NOT NULL
      AND work_permit_expiry >= v_today
      AND work_permit_expiry <= v_today + p_permit_warn
  )
  SELECT jsonb_build_object(
    'people', COUNT(*),
    'crit',   COUNT(*) FILTER (WHERE exp <= v_today + p_permit_crit),
    'list',   COALESCE(jsonb_agg(jsonb_build_object('name', name, 'expires_at', exp) ORDER BY exp), '[]'::jsonb)
  ) INTO v_permit FROM wp;

  -- 試用期到期（warn 天內）
  WITH pb AS (
    SELECT name, probation_end AS pend
    FROM employees
    WHERE organization_id = p_org AND status = '在職'
      AND probation_end IS NOT NULL
      AND probation_end >= v_today
      AND probation_end <= v_today + p_probation_warn
  )
  SELECT jsonb_build_object(
    'people', COUNT(*),
    'list',   COALESCE(jsonb_agg(jsonb_build_object('name', name, 'end', pend) ORDER BY pend), '[]'::jsonb)
  ) INTO v_prob FROM pb;

  -- ── 薪資成本（只給 admin/super_admin 或有 salary.view_all 權限者）──
  IF current_employee_role() IN ('admin','super_admin') OR public.current_user_can('salary.view_all') THEN
    SELECT max(month) INTO v_cur_month FROM salary_records WHERE organization_id = p_org;
    IF v_cur_month IS NOT NULL THEN
      v_prev_month := to_char(to_date(v_cur_month || '-01','YYYY-MM-DD') - interval '1 month', 'YYYY-MM');
      SELECT jsonb_build_object(
        'month',      v_cur_month,
        'this_total', COALESCE(SUM(net_salary)   FILTER (WHERE month = v_cur_month), 0),
        'last_total', COALESCE(SUM(net_salary)   FILTER (WHERE month = v_prev_month), 0),
        'ot_total',   COALESCE(SUM(overtime_pay) FILTER (WHERE month = v_cur_month), 0)
      ) INTO v_salary
      FROM salary_records
      WHERE organization_id = p_org AND month IN (v_cur_month, v_prev_month);

      SELECT v_salary || jsonb_build_object('by_dept',
        COALESCE(jsonb_agg(d ORDER BY (d->>'total')::numeric DESC), '[]'::jsonb))
      INTO v_salary
      FROM (
        SELECT jsonb_build_object(
                 'dept',  COALESCE(NULLIF(e.dept,''), '(未分部門)'),
                 'total', SUM(sr.net_salary)
               ) AS d
        FROM salary_records sr
        JOIN employees e ON e.id = sr.employee_id
        WHERE sr.organization_id = p_org AND sr.month = v_cur_month
        GROUP BY COALESCE(NULLIF(e.dept,''), '(未分部門)')
      ) x;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'leave_expiry',     v_leave,
    'permit_expiry',    v_permit,
    'probation_ending', v_prob,
    'salary_cost',      v_salary,
    'thresholds', jsonb_build_object(
      'leave_warn', p_leave_warn, 'leave_crit', p_leave_crit,
      'permit_warn', p_permit_warn, 'permit_crit', p_permit_crit,
      'probation_warn', p_probation_warn
    )
  );
END $function$
;

-- ═══════════ get_payroll_transfer_file(p_period text, p_org integer) ═══════════
CREATE OR REPLACE FUNCTION public.get_payroll_transfer_file(p_period text, p_org integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result json;
BEGIN
  IF auth.uid() IS NOT NULL AND current_employee_role() NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT COALESCE(json_agg(json_build_object(
    'employee_number', e.employee_number,
    'name',            sr.employee,
    'id_number',       e.id_number,
    'bank_code',       ba.bank_code,
    'bank_branch',     ba.bank_branch,
    'bank_account',    ba.bank_account,
    'amount',          sr.net_salary,
    'has_account',     (ba.bank_account IS NOT NULL AND btrim(ba.bank_account) <> '')
  ) ORDER BY e.employee_number NULLS LAST, sr.employee), '[]'::json)
  INTO v_result
  FROM salary_records sr
  LEFT JOIN employees e
    ON e.name = sr.employee AND e.organization_id = p_org
  LEFT JOIN employee_bank_accounts ba
    ON ba.employee_id = e.id
  WHERE sr.organization_id = p_org
    AND sr.month = p_period;

  RETURN v_result;
END $function$
;

-- ═══════════ hr_chain_approve(p_table text, p_id integer, p_approver_id integer, p_action text, p_reason text) ═══════════
CREATE OR REPLACE FUNCTION public.hr_chain_approve(p_table text, p_id integer, p_approver_id integer, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table_name        TEXT;
  v_snap_request_type TEXT;
  v_record            RECORD;
  v_chain_id          INT;
  v_cur_step          INT;
  v_total_steps       INT;
  v_step              approval_chain_steps;
  v_is_last           BOOLEAN;
  v_next_step         approval_chain_steps;
  v_next_ids          INT[];
  v_next_json         JSON;
  v_extra             approval_extra_steps;
  v_has_snapshot      BOOLEAN;
  v_matches           BOOLEAN;
BEGIN
  v_table_name := CASE p_table
    WHEN 'resignation' THEN 'resignation_requests'
    WHEN 'loa'         THEN 'leave_of_absence_requests'
    WHEN 'transfer'    THEN 'personnel_transfer_requests'
    WHEN 'headcount'   THEN 'headcount_requests'
    ELSE NULL
  END;
  IF v_table_name IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_TABLE');
  END IF;

  -- snapshot request_type
  v_snap_request_type := p_table;  -- 'resignation' / 'loa' / 'transfer' / 'headcount' 對齊

  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  EXECUTE format('SELECT id, approval_chain_id, current_step, status, employee_id, organization_id FROM %I WHERE id = $1', v_table_name)
    INTO v_record USING p_id;

  IF v_record.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_record.status <> '申請中' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  v_chain_id := v_record.approval_chain_id;
  v_cur_step := v_record.current_step;

  -- 加簽 guard
  v_extra := public.get_pending_extra_step(v_table_name, p_id, COALESCE(v_cur_step, 0));
  IF v_extra.id IS NOT NULL THEN
    RETURN json_build_object(
      'ok', false, 'error', 'PENDING_EXTRA_SIGNER',
      'extra_step_id', v_extra.id, 'extra_assignee_id', v_extra.assignee_id,
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
    );
  END IF;

  -- 沒 chain → 舊行為
  IF v_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW() WHERE id=$3', v_table_name)
        USING '已核准', p_approver_id, p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved_no_chain');
    ELSE
      EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW(), reject_reason=$3 WHERE id=$4', v_table_name)
        USING '已駁回', p_approver_id, btrim(p_reason), p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected_no_chain');
    END IF;
  END IF;

  -- snapshot 優先
  SELECT EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = v_snap_request_type AND request_id = p_id
  ) INTO v_has_snapshot;

  IF v_has_snapshot THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.request_chain_snapshots
       WHERE request_type = v_snap_request_type AND request_id = p_id AND step_order = v_cur_step
    ) THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND', 'source', 'snapshot');
    END IF;

    SELECT public._employee_matches_snapshot_step(
      p_approver_id, v_snap_request_type, p_id, v_cur_step, v_record.employee_id
    ) INTO v_matches;

    SELECT COUNT(*) INTO v_total_steps
      FROM public.request_chain_snapshots
     WHERE request_type = v_snap_request_type AND request_id = p_id;
  ELSE
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = v_cur_step;
    IF v_step.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND', 'source', 'live_chain');
    END IF;
    SELECT public._employee_matches_chain_step(p_approver_id, v_step.id, v_record.employee_id)
      INTO v_matches;
    SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_chain_id;
  END IF;

  IF NOT v_matches THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  v_is_last := (v_cur_step + 1 >= v_total_steps);

  IF p_action = 'reject' THEN
    EXECUTE format('UPDATE %I SET status=$1, reject_reason=$2, approver_id=$3 WHERE id=$4', v_table_name)
      USING '已駁回', btrim(p_reason), p_approver_id, p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected', 'rejected_at_step', v_cur_step);
  END IF;

  IF v_is_last THEN
    EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW() WHERE id=$3', v_table_name)
      USING '已核准', p_approver_id, p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved', 'is_last_step', true);
  ELSE
    EXECUTE format('UPDATE %I SET current_step=current_step+1 WHERE id=$1', v_table_name) USING p_id;

    -- 下關 approver（snapshot 優先）
    IF v_has_snapshot THEN
      SELECT json_agg(json_build_object('emp_id', a.emp_id, 'name', a.emp_name))
        INTO v_next_json
        FROM public.resolve_snapshot_step_approvers(
          v_snap_request_type, p_id, v_cur_step + 1, v_record.employee_id
        ) a;
    ELSE
      SELECT * INTO v_next_step FROM approval_chain_steps
       WHERE chain_id = v_chain_id AND step_order = v_cur_step + 1;
      SELECT array_agg(e.id) INTO v_next_ids FROM employees e
       WHERE e.status='在職' AND e.organization_id = v_record.organization_id
         AND public._employee_matches_chain_step(e.id, v_next_step.id, v_record.employee_id);
      SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_json
        FROM employees WHERE id = ANY(COALESCE(v_next_ids, ARRAY[]::INT[]));
    END IF;

    RETURN json_build_object('ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', v_cur_step + 1, 'is_last_step', false,
      'next_approvers', COALESCE(v_next_json, '[]'::json));
  END IF;
END
$function$
;

-- ═══════════ import_employee_bank_account(p_employee_number text, p_name text, p_bank_code text, p_bank_branch text, p_bank_account text) ═══════════
CREATE OR REPLACE FUNCTION public.import_employee_bank_account(p_employee_number text, p_name text, p_bank_code text, p_bank_branch text, p_bank_account text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_emp employees; v_by TEXT;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_manage_bank() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  IF p_employee_number IS NOT NULL AND btrim(p_employee_number) <> '' THEN
    SELECT * INTO v_emp FROM employees WHERE employee_number = btrim(p_employee_number) LIMIT 1;
    IF v_emp.id IS NOT NULL THEN v_by := 'employee_number'; END IF;
  END IF;
  IF v_emp.id IS NULL AND p_name IS NOT NULL AND btrim(p_name) <> '' THEN
    SELECT * INTO v_emp FROM employees WHERE name = btrim(p_name) LIMIT 1;
    IF v_emp.id IS NOT NULL THEN v_by := 'name'; END IF;
  END IF;
  IF v_emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND',
      'employee_number', p_employee_number, 'name', p_name);
  END IF;

  INSERT INTO employee_bank_accounts
    (employee_id, organization_id, bank_code, bank_branch, bank_account, account_holder)
  VALUES
    (v_emp.id, v_emp.organization_id,
     NULLIF(btrim(p_bank_code),''), NULLIF(btrim(p_bank_branch),''),
     NULLIF(btrim(p_bank_account),''), NULLIF(btrim(p_name),''))
  ON CONFLICT (employee_id) DO UPDATE SET
    bank_code      = EXCLUDED.bank_code,
    bank_branch    = EXCLUDED.bank_branch,
    bank_account   = EXCLUDED.bank_account,
    account_holder = COALESCE(EXCLUDED.account_holder, employee_bank_accounts.account_holder),
    updated_at     = now();

  RETURN jsonb_build_object('ok', true, 'employee_id', v_emp.id, 'name', v_emp.name, 'matched_by', v_by);
END $function$
;

-- ═══════════ liff_approve_request(p_line_user_id text, p_type text, p_id integer, p_action text, p_reason text) ═══════════
CREATE OR REPLACE FUNCTION public.liff_approve_request(p_line_user_id text, p_type text, p_id integer, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp             employees;
  v_app_emp_id    INT;
  v_app_name      TEXT;
  v_app_org       INT;
  v_eligible      BOOLEAN;
  reject_val      text;
  approve_status  text;
  reject_status   text;
  result_status   text;
  v_chain_id      int;
  v_cur_step      int;
  v_step          approval_chain_steps;
  v_total_steps   int;
  v_is_last       boolean;
  v_table_name    text;
  v_er            record;
  v_next_step     approval_chain_steps;
  v_next_approver_ids INT[];
  v_next_approvers json;
  v_amount        NUMERIC;
  -- snapshot
  v_has_snapshot  BOOLEAN;
  v_snap_matches  BOOLEAN;
  v_snap_rt       TEXT;
  -- skip-if-no-approver
  v_effective_step INT;
  v_step_skipped   BOOLEAN;
  -- extra step
  v_pending_extra INT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_action NOT IN ('approve','reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  reject_val := COALESCE(p_reason, '');

  -- ════ HR A 類 + expense（單表 chain） ════
  IF p_type IN ('leave','overtime','trip','correction','expense') THEN
    v_table_name := CASE p_type
      WHEN 'leave'      THEN 'leave_requests'
      WHEN 'overtime'   THEN 'overtime_requests'
      WHEN 'trip'       THEN 'business_trips'
      WHEN 'correction' THEN 'clock_corrections'
      WHEN 'expense'    THEN 'expenses'
    END;

    IF p_type IN ('leave','overtime') THEN
      EXECUTE format('SELECT approval_chain_id, current_step, organization_id, employee_id, employee, status FROM %I WHERE id=$1', v_table_name)
        INTO v_chain_id, v_cur_step, v_app_org, v_app_emp_id, v_app_name, result_status USING p_id;
    ELSE
      EXECUTE format('SELECT approval_chain_id, current_step, organization_id, NULL::INT, employee, status FROM %I WHERE id=$1', v_table_name)
        INTO v_chain_id, v_cur_step, v_app_org, v_app_emp_id, v_app_name, result_status USING p_id;
    END IF;

    IF v_app_name IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
    END IF;
    IF result_status NOT IN ('申請中', '待審') THEN
      RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
    END IF;
    IF v_app_org IS NOT NULL AND v_app_org <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;

    approve_status := CASE p_type WHEN 'expense' THEN '已核銷' ELSE '已核准' END;
    reject_status  := '已退回';

    IF v_chain_id IS NOT NULL THEN
      -- snapshot 優先（leave / overtime / trip / correction）
      v_has_snapshot := FALSE;
      IF p_type IN ('leave','overtime','trip','correction') THEN
        v_snap_rt := CASE p_type
          WHEN 'leave'      THEN 'leave_request'
          WHEN 'overtime'   THEN 'overtime_request'
          WHEN 'trip'       THEN 'trip'
          WHEN 'correction' THEN 'correction'
        END;
        SELECT EXISTS(
          SELECT 1 FROM public.request_chain_snapshots
           WHERE request_type = v_snap_rt AND request_id = p_id
        ) INTO v_has_snapshot;
        IF v_has_snapshot THEN
          SELECT public._employee_matches_snapshot_step(
            emp.id, v_snap_rt, p_id, v_cur_step, v_app_emp_id
          ) INTO v_snap_matches;
          IF NOT v_snap_matches THEN
            RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN',
              'source', 'snapshot', 'current_step', v_cur_step);
          END IF;
        END IF;
      END IF;

      IF NOT v_has_snapshot THEN
        SELECT * INTO v_step FROM approval_chain_steps
         WHERE chain_id = v_chain_id AND step_order = v_cur_step;
        IF v_step.id IS NULL THEN
          RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
        END IF;
        IF NOT public._employee_matches_chain_step(emp.id, v_step.id, v_app_emp_id) THEN
          RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
        END IF;
      END IF;

      SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_chain_id;
      v_is_last := (v_cur_step + 1 >= v_total_steps);

      IF p_action = 'reject' THEN
        EXECUTE format('UPDATE %I SET status=$1, reject_reason=$2, approved_by=$3 WHERE id=$4', v_table_name)
          USING reject_status, reject_val, emp.name, p_id;
        IF p_type = 'correction' THEN
          EXECUTE format('UPDATE %I SET status=$1 WHERE id=$2', v_table_name) USING '已駁回', p_id;
        END IF;
        RETURN json_build_object('ok', true, 'status', reject_status, 'event','rejected',
          'rejected_at_step', v_cur_step,
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      END IF;

      IF v_is_last THEN
        EXECUTE format('UPDATE %I SET status=$1, approved_by=$2 WHERE id=$3', v_table_name)
          USING approve_status, emp.name, p_id;
        RETURN json_build_object('ok', true, 'status', approve_status, 'event','approved', 'is_last_step', true,
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      ELSE
        -- ── advance，自動跳過 auto_skipped 步 ──
        v_effective_step := v_cur_step + 1;

        IF v_snap_rt IS NOT NULL THEN
          LOOP
            EXIT WHEN v_effective_step >= v_total_steps;
            SELECT COALESCE(rcs.auto_skipped, false) INTO v_step_skipped
              FROM public.request_chain_snapshots rcs
             WHERE rcs.request_type = v_snap_rt
               AND rcs.request_id   = p_id
               AND rcs.step_order   = v_effective_step;
            EXIT WHEN NOT COALESCE(v_step_skipped, false);
            v_effective_step := v_effective_step + 1;
          END LOOP;
        END IF;

        -- 所有剩餘步驟都被跳過 → 直接核准
        IF v_effective_step >= v_total_steps THEN
          EXECUTE format('UPDATE %I SET status=$1, current_step=$2, approved_by=$3 WHERE id=$4', v_table_name)
            USING approve_status, v_effective_step, emp.name, p_id;
          RETURN json_build_object('ok', true, 'status', approve_status, 'event', 'approved', 'is_last_step', true,
            'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
        END IF;

        EXECUTE format('UPDATE %I SET current_step=$1 WHERE id=$2', v_table_name) USING v_effective_step, p_id;
        SELECT * INTO v_next_step FROM approval_chain_steps
         WHERE chain_id = v_chain_id AND step_order = v_effective_step;
        SELECT array_agg(e.id) INTO v_next_approver_ids FROM employees e
         WHERE e.status='在職' AND e.organization_id = v_app_org
           AND public._employee_matches_chain_step(e.id, v_next_step.id, v_app_emp_id);
        SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
          FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));
        RETURN json_build_object('ok', true, 'status','簽核中', 'event','advanced',
          'advanced_to_step', v_effective_step, 'is_last_step', false,
          'next_approvers', COALESCE(v_next_approvers, '[]'::json),
          'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
      END IF;
    END IF;

    -- 沒掛 chain → fallback 組織圖
    SELECT public._employee_is_eligible_approver(emp.id, v_app_emp_id, v_app_org)
      INTO v_eligible;
    IF NOT v_eligible THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;
    IF p_action = 'reject' THEN
      EXECUTE format('UPDATE %I SET status=$1, reject_reason=$2, approved_by=$3 WHERE id=$4', v_table_name)
        USING reject_status, reject_val, emp.name, p_id;
      RETURN json_build_object('ok', true, 'status', reject_status, 'event','rejected',
        'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
    ELSE
      EXECUTE format('UPDATE %I SET status=$1, approved_by=$2 WHERE id=$3', v_table_name)
        USING approve_status, emp.name, p_id;
      RETURN json_build_object('ok', true, 'status', approve_status, 'event','approved',
        'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name));
    END IF;
  END IF;

  -- ════ expense_request 走 chain ════
  IF p_type = 'expense_request' THEN
    SELECT * INTO v_er FROM expense_requests WHERE id = p_id;
    IF v_er.id IS NULL OR v_er.status <> '申請中' THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;
    IF v_er.organization_id IS NOT NULL AND v_er.organization_id <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;
    IF v_er.approval_chain_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NO_CHAIN_ATTACHED');
    END IF;

    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_er.approval_chain_id AND step_order = v_er.current_step;
    IF v_step.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
    END IF;
    IF NOT public._employee_matches_chain_step(emp.id, v_step.id, v_er.employee_id) THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;

    SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_er.approval_chain_id;
    v_is_last := (v_er.current_step + 1 >= v_total_steps);

    IF p_action = 'reject' THEN
      UPDATE expense_requests SET status='已退回', reject_reason=reject_val, approved_by=emp.name WHERE id=p_id;
      RETURN json_build_object('ok', true, 'status','已退回', 'event','rejected',
        'rejected_at_step', v_er.current_step,
        'applicant', json_build_object('emp_id',
          (SELECT id FROM employees WHERE name=v_er.employee AND organization_id=v_er.organization_id LIMIT 1),
          'name', v_er.employee));
    END IF;

    IF v_is_last THEN
      UPDATE expense_requests SET status='已核准', approved_by=emp.name, approved_at=NOW() WHERE id=p_id;
      RETURN json_build_object('ok', true, 'status','已核准', 'event','approved', 'is_last_step', true,
        'applicant', json_build_object('emp_id',
          (SELECT id FROM employees WHERE name=v_er.employee AND organization_id=v_er.organization_id LIMIT 1),
          'name', v_er.employee));
    ELSE
      UPDATE expense_requests SET current_step=current_step+1 WHERE id=p_id;
      SELECT * INTO v_next_step FROM approval_chain_steps
       WHERE chain_id = v_er.approval_chain_id AND step_order = v_er.current_step + 1;
      SELECT array_agg(e.id) INTO v_next_approver_ids FROM employees e
       WHERE e.status='在職' AND e.organization_id = v_er.organization_id
         AND public._employee_matches_chain_step(e.id, v_next_step.id, v_er.employee_id);
      SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
        FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));
      RETURN json_build_object('ok', true, 'status','簽核中', 'event','advanced',
        'advanced_to_step', v_er.current_step + 1, 'is_last_step', false,
        'next_approvers', COALESCE(v_next_approvers, '[]'::json),
        'applicant', json_build_object('emp_id',
          (SELECT id FROM employees WHERE name=v_er.employee AND organization_id=v_er.organization_id LIMIT 1),
          'name', v_er.employee));
    END IF;
  END IF;

  -- ════ expense_settle（核銷）走 settle_chain + snapshot ════
  IF p_type = 'expense_settle' THEN
    SELECT * INTO v_er FROM expense_requests WHERE id = p_id;
    IF v_er.id IS NULL OR v_er.status <> '待核銷' THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;
    IF v_er.organization_id IS NOT NULL AND v_er.organization_id <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;
    IF v_er.settle_chain_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NO_CHAIN_ATTACHED');
    END IF;

    SELECT id INTO v_pending_extra
      FROM public.approval_extra_steps
     WHERE source_table = 'expense_settles'
       AND source_id = p_id
       AND insert_before_step = v_er.settle_current_step
       AND status = 'pending'
     LIMIT 1;
    IF v_pending_extra IS NOT NULL THEN
      RETURN json_build_object('ok', false, 'error', 'PENDING_EXTRA_STEP', 'extra_step_id', v_pending_extra);
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.request_chain_snapshots
       WHERE request_type = 'expense_settle' AND request_id = p_id
    ) INTO v_has_snapshot;

    IF v_has_snapshot THEN
      SELECT public._employee_matches_snapshot_step(
        emp.id, 'expense_settle', p_id, v_er.settle_current_step, v_er.employee_id
      ) INTO v_snap_matches;
      IF NOT v_snap_matches THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN',
          'source', 'snapshot', 'current_step', v_er.settle_current_step);
      END IF;
    ELSE
      SELECT * INTO v_step FROM approval_chain_steps
       WHERE chain_id = v_er.settle_chain_id AND step_order = v_er.settle_current_step;
      IF v_step.id IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
      END IF;
      IF NOT public._employee_matches_chain_step(emp.id, v_step.id, v_er.employee_id) THEN
        RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
      END IF;
    END IF;

    SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_er.settle_chain_id;
    v_is_last := (v_er.settle_current_step + 1 >= v_total_steps);

    IF p_action = 'reject' THEN
      UPDATE expense_requests SET status='核銷已退回', settle_reject_reason=reject_val WHERE id=p_id;
      RETURN json_build_object('ok', true, 'status','核銷已退回', 'event','rejected',
        'rejected_at_step', v_er.settle_current_step,
        'applicant', json_build_object('emp_id', v_er.employee_id, 'name', v_er.employee));
    END IF;

    IF v_is_last THEN
      v_amount := COALESCE(v_er.actual_amount, v_er.estimated_amount, 0);
      BEGIN
        PERFORM secure_create_journal_entry(
          CURRENT_DATE,
          '費用申請核銷 - ' || v_er.employee || ' (' || v_er.title || ')',
          json_build_array(
            json_build_object('account_code', v_er.account_code, 'account_name', v_er.account_name,
              'debit', v_amount, 'credit', 0, 'memo', '申請單 #' || v_er.id),
            json_build_object('account_code', '1100', 'account_name', '現金',
              'debit', 0, 'credit', v_amount, 'memo', '')
          )::jsonb, '費用申請', v_er.id, emp.name
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      UPDATE expense_requests SET
        status='已核銷',
        settle_current_step = v_total_steps,
        settled_by = emp.name,
        settled_at = NOW()
      WHERE id=p_id;
      RETURN json_build_object('ok', true, 'status','已核銷', 'event','approved', 'is_last_step', true,
        'applicant', json_build_object('emp_id', v_er.employee_id, 'name', v_er.employee));
    ELSE
      UPDATE expense_requests SET settle_current_step = settle_current_step + 1 WHERE id=p_id;
      SELECT * INTO v_next_step FROM approval_chain_steps
       WHERE chain_id = v_er.settle_chain_id AND step_order = v_er.settle_current_step + 1;
      SELECT array_agg(e.id) INTO v_next_approver_ids FROM employees e
       WHERE e.status='在職' AND e.organization_id = v_er.organization_id
         AND public._employee_matches_chain_step(e.id, v_next_step.id, v_er.employee_id);
      SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
        FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));
      RETURN json_build_object('ok', true, 'status','核銷中', 'event','advanced',
        'advanced_to_step', v_er.settle_current_step + 1, 'is_last_step', false,
        'next_approvers', COALESCE(v_next_approvers, '[]'::json),
        'applicant', json_build_object('emp_id', v_er.employee_id, 'name', v_er.employee));
    END IF;
  END IF;

  RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
END $function$
;

-- ═══════════ liff_list_pending_approvals(p_line_user_id text) ═══════════
CREATE OR REPLACE FUNCTION public.liff_list_pending_approvals(p_line_user_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp    employees;
  result json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object(
      'leaves','[]'::json,'overtimes','[]'::json,'trips','[]'::json,
      'expenses','[]'::json,'corrections','[]'::json,'expense_requests','[]'::json,
      'expense_settles','[]'::json,
      'resignation_requests','[]'::json,'leave_of_absence_requests','[]'::json,
      'personnel_transfer_requests','[]'::json,'headcount_requests','[]'::json,
      'form_submissions','[]'::json,
      'task_confirmations','[]'::json,
      'shift_swaps_for_peer','[]'::json,'shift_swaps_for_manager','[]'::json,
      'off_requests','[]'::json,
      'can', json_build_object('hr', false, 'finance', false)
    );
  END IF;

  SELECT json_build_object(
    'leaves', (
      SELECT COALESCE(json_agg(
        (to_jsonb(l.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('leave_requests', l.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', l.employee_id = emp.id
        ))::json ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id AND l.status = '待審核'
        AND l.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)) AND COALESCE(l.employee_id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('leave_requests', l.id, emp.id))
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(
        (to_jsonb(o.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('overtime_requests', o.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', o.employee_id = emp.id
        ))::json ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核'
        AND o.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)) AND COALESCE(o.employee_id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('overtime_requests', o.id, emp.id))
    ),
    'trips', (
      SELECT COALESCE(json_agg(
        (to_jsonb(t.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('business_trips', t.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', e_app.id = emp.id
        ))::json ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1) e_app ON true
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核'
        AND t.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))) AND COALESCE(e_app.id, -1) <> emp.id)
          OR public._has_pending_extra_for_me('business_trips', t.id, emp.id))
    ),
    'corrections', (
      SELECT COALESCE(json_agg(
        (to_jsonb(c.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('clock_corrections', c.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', e_app.id = emp.id
        ))::json ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核'
        AND c.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id)
          OR public._has_pending_extra_for_me('clock_corrections', c.id, emp.id))
    ),
    'expenses', (
      -- expenses 表沒 deleted_at（不在 soft-delete 範圍）
      SELECT COALESCE(json_agg(
        (to_jsonb(ex.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('expenses', ex.id, emp.id) THEN 'extra_signer'
            ELSE 'direct_manager'
          END,
          'is_self_approve', e_app.id = emp.id
        ))::json ORDER BY ex.created_at DESC), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核'
        AND ((ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)) AND e_app.id <> emp.id)
          OR public._has_pending_extra_for_me('expenses', ex.id, emp.id))
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', er.id, 'employee', er.employee, 'department', er.department, 'title', er.title,
        'description', er.description, 'estimated_amount', er.estimated_amount,
        'account_code', er.account_code, 'account_name', er.account_name,
        'store', er.store, 'status', er.status, 'created_at', er.created_at,
        'reject_reason', er.reject_reason,
        'approval_chain_id', er.approval_chain_id, 'current_step', er.current_step,
        'chain_name', ac.name,
        'chain_total_steps', (SELECT COUNT(*) FROM approval_chain_steps WHERE chain_id = er.approval_chain_id),
        'my_step_label', cur_step.label,
        'my_approver_role', CASE
          WHEN er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id) THEN cur_step.target_type
          WHEN public._has_pending_extra_for_me('expense_requests', er.id, emp.id) THEN 'extra_signer'
          ELSE NULL
        END,
        'is_self_approve', er.employee_id = emp.id
      ) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chains ac ON ac.id = er.approval_chain_id
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.approval_chain_id AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '申請中'
        AND er.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id))
          OR public._has_pending_extra_for_me('expense_requests', er.id, emp.id))
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(
        (to_jsonb(er.*) || jsonb_build_object(
          'my_step_label', cur_step.label,
          'my_approver_role', cur_step.target_type,
          'is_self_approve', er.employee_id = emp.id
        ))::json ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.settle_chain_id AND cur_step.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '待核銷'
        AND er.deleted_at IS NULL  -- ★ soft-delete filter
        AND er.settle_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'resignation_requests', (
      -- resignation_requests 表沒 deleted_at（不在 soft-delete 範圍）
      SELECT COALESCE(json_agg(
        (to_jsonb(r.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('resignation_requests', r.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', r.employee_id = emp.id
        ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('resignation_requests', r.id, emp.id))
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(
        (to_jsonb(r.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', r.employee_id = emp.id
        ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id))
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(
        (to_jsonb(r.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', r.employee_id = emp.id
        ))::json ORDER BY r.created_at DESC), '[]'::json)
      FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中'
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id))
    ),
    'headcount_requests', (
      SELECT COALESCE(json_agg(
        (to_jsonb(h.*) || jsonb_build_object(
          'my_step_label', cs.label,
          'my_approver_role', CASE
            WHEN h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL
              AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id) THEN cs.target_type
            WHEN public._has_pending_extra_for_me('headcount_requests', h.id, emp.id) THEN 'extra_signer'
            ELSE NULL
          END,
          'is_self_approve', h.employee_id = emp.id
        ))::json ORDER BY h.created_at DESC), '[]'::json)
      FROM public.headcount_requests h
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = h.approval_chain_id AND cs.step_order = h.current_step
      WHERE h.organization_id = emp.organization_id AND h.status = '申請中'
        AND h.deleted_at IS NULL  -- ★ soft-delete filter
        AND ((h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id))
          OR public._has_pending_extra_for_me('headcount_requests', h.id, emp.id))
    ),
    'form_submissions', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', s.id, 'template_id', s.template_id, 'template_name', t.name,
        'template_fields', t.fields,
        'applicant_id', s.applicant_id, 'applicant_name', e_app.name,
        'data', s.data, 'status', s.status, 'created_at', s.created_at,
        'current_step', s.current_step,
        'chain_id', t.approval_chain_id,
        'my_step_label', cur_step.label,
        'my_approver_role', CASE
          WHEN t.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, s.applicant_id) THEN cur_step.target_type
          WHEN public._has_pending_extra_for_me('form_submissions', s.id, emp.id) THEN 'extra_signer'
          ELSE NULL
        END,
        'is_self_approve', s.applicant_id = emp.id,
        'attachments', (
          SELECT COALESCE(json_agg(json_build_object(
            'id', a.id, 'file_name', a.file_name,
            'storage_bucket', a.storage_bucket, 'storage_path', a.storage_path,
            'mime_type', a.mime_type, 'file_size', a.file_size
          ) ORDER BY a.created_at), '[]'::json)
          FROM public.form_attachments a
          WHERE a.form_type = 'form_submissions' AND a.form_id = s.id
        )
      ) ORDER BY s.created_at DESC), '[]'::json)
      FROM public.form_submissions s
      JOIN public.form_templates t ON t.id = s.template_id
      LEFT JOIN public.employees e_app ON e_app.id = s.applicant_id
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = t.approval_chain_id AND cur_step.step_order = s.current_step
      WHERE s.organization_id = emp.organization_id AND s.status = '申請中'
        AND s.deleted_at IS NULL  -- ★ soft-delete filter
        AND (
          (t.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, s.applicant_id))
          OR public._has_pending_extra_for_me('form_submissions', s.id, emp.id)
        )
    ),
    'task_confirmations', '[]'::json,
    'shift_swaps_for_peer', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json) FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待對方同意'
        AND ss.deleted_at IS NULL  -- ★ soft-delete filter
        AND ss.target_id = emp.id AND ss.requester_id <> emp.id
    ),
    'shift_swaps_for_manager', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json) FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待主管核准'
        AND ss.deleted_at IS NULL  -- ★ soft-delete filter
        AND ss.requester_id <> emp.id AND ss.target_id <> emp.id
        AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
             OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(row_to_json(ofr.*) ORDER BY ofr.created_at DESC), '[]'::json) FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id AND ofr.status = '待審核'
        AND ofr.deleted_at IS NULL  -- ★ soft-delete filter
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(ofr.employee_id))
        AND COALESCE(ofr.employee_id, -1) <> emp.id
    ),
    'can', json_build_object(
      'hr', public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', (public.liff_employee_has_permission(emp.id, 'expense.approve') OR public.liff_employee_has_permission(emp.id, 'expense.settle'))
    )
  ) INTO result;
  RETURN result;
END
$function$
;

-- ═══════════ lock_schedule_month(p_store_id integer, p_month text) ═══════════
CREATE OR REPLACE FUNCTION public.lock_schedule_month(p_store_id integer, p_month text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp_id INT;
  v_start  DATE := (p_month || '-01')::date;
  v_end    DATE := ((p_month || '-01')::date + INTERVAL '1 month - 1 day')::date;
  v_count  INT;
BEGIN
  SELECT id INTO v_emp_id FROM employees
   WHERE auth_user_id = auth.uid()
      OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
   LIMIT 1;

  UPDATE schedules s SET status = 'published'
   WHERE s.date BETWEEN v_start AND v_end
     AND s.employee IN (SELECT name FROM employees WHERE store_id = p_store_id)
     AND s.status = 'draft';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO schedule_month_locks (store_id, month, locked_at, locked_by)
  VALUES (p_store_id, p_month, now(), v_emp_id)
  ON CONFLICT (store_id, month) DO UPDATE
    SET locked_at = now(), locked_by = EXCLUDED.locked_by;

  RETURN jsonb_build_object('ok', true, 'locked_rows', v_count, 'month', p_month);
END $function$
;

-- ═══════════ preview_payroll(p_period text, p_org integer, p_store_filter text) ═══════════
CREATE OR REPLACE FUNCTION public.preview_payroll(p_period text, p_org integer, p_store_filter text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_year   INT  := split_part(p_period,'-',1)::int;
  v_month  INT  := split_part(p_period,'-',2)::int;
  v_mstart date := make_date(v_year, v_month, 1);
  v_mend   date := (make_date(v_year, v_month, 1) + interval '1 month - 1 day')::date;
  v_result json;
BEGIN
  SELECT COALESCE(json_agg(public._compute_payroll_for_employee(e.id, p_period) ORDER BY e.name), '[]'::json)
    INTO v_result
  FROM employees e
  WHERE e.organization_id = p_org
    AND (e.in_payroll IS NOT FALSE)   -- 編制外員工不納入薪資計算
    -- 到職<=月底 且 (在職 或 當月離職)，以計薪月份為準、非相對今天
    AND (e.join_date IS NULL OR e.join_date <= v_mend)
    AND (
      e.status = '在職'
      OR (e.status = '離職'
          AND e.resign_date IS NOT NULL
          AND e.resign_date >= v_mstart
          AND e.resign_date <= v_mend)
    )
    AND (
      p_store_filter IS NULL
      OR e.store = p_store_filter
      OR (e.additional_stores IS NOT NULL AND p_store_filter = ANY(e.additional_stores))
    );
  RETURN v_result;
END $function$
;

-- ═══════════ resolve_snapshot_step_approvers(p_request_type text, p_request_id integer, p_step_order integer, p_applicant_emp_id integer) ═══════════
CREATE OR REPLACE FUNCTION public.resolve_snapshot_step_approvers(p_request_type text, p_request_id integer, p_step_order integer, p_applicant_emp_id integer)
 RETURNS TABLE(emp_id integer, emp_name text, line_user_id text, channel_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_snap          public.request_chain_snapshots;
  v_app           employees;
  v_target_emp_id INT;
  v_section_id    INT;
  v_store_id      INT;
BEGIN
  SELECT * INTO v_snap
    FROM public.request_chain_snapshots
   WHERE request_type = p_request_type
     AND request_id   = p_request_id
     AND step_order   = p_step_order;
  IF v_snap.id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;

  -- ─────── fixed_* ───────
  IF v_snap.target_type = 'fixed_emp' AND v_snap.target_emp_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.id = v_snap.target_emp_id AND e.status = '在職';
    RETURN;
  END IF;

  IF v_snap.target_type = 'fixed_role' AND v_snap.target_role_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.role_id = v_snap.target_role_id AND e.status = '在職'
        AND (v_app.organization_id IS NULL OR e.organization_id = v_app.organization_id);
    RETURN;
  END IF;

  IF v_snap.target_type = 'fixed_dept' AND v_snap.target_dept_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e WHERE e.department_id = v_snap.target_dept_id AND e.status = '在職';
    RETURN;
  END IF;

  IF v_app.id IS NULL THEN RETURN; END IF;

  -- ─────── applicant_supervisor L1/L2/L3 ───────
  IF v_snap.target_type = 'applicant_supervisor' THEN
    v_target_emp_id := COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- ★ L2
  IF v_snap.target_type = 'applicant_supervisor_l2' THEN
    v_target_emp_id := COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_target_emp_id IS NOT NULL THEN
      SELECT COALESCE(e.supervisor_id, e.reporting_to) INTO v_target_emp_id
        FROM employees e WHERE e.id = v_target_emp_id;
      IF v_target_emp_id IS NOT NULL THEN
        RETURN QUERY
          SELECT e.id, e.name,
            (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
            (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
          FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
      END IF;
    END IF;
    RETURN;
  END IF;

  -- ★ L3
  IF v_snap.target_type = 'applicant_supervisor_l3' THEN
    v_target_emp_id := COALESCE(v_app.supervisor_id, v_app.reporting_to);
    IF v_target_emp_id IS NOT NULL THEN
      SELECT COALESCE(e.supervisor_id, e.reporting_to) INTO v_target_emp_id
        FROM employees e WHERE e.id = v_target_emp_id;
      IF v_target_emp_id IS NOT NULL THEN
        SELECT COALESCE(e.supervisor_id, e.reporting_to) INTO v_target_emp_id
          FROM employees e WHERE e.id = v_target_emp_id;
        IF v_target_emp_id IS NOT NULL THEN
          RETURN QUERY
            SELECT e.id, e.name,
              (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
              (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
            FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
        END IF;
      END IF;
    END IF;
    RETURN;
  END IF;

  -- ─────── 其餘 applicant_* ───────
  IF v_snap.target_type = 'applicant_dept_manager' AND v_app.department_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_app.department_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'applicant_store_manager' AND v_app.store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_app.store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'applicant_store_supervisor' AND v_app.store_id IS NOT NULL THEN
    RETURN QUERY
      SELECT e.id, e.name,
        (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
        (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
      FROM employees e
      WHERE e.store_id = v_app.store_id
        AND e.position = '督導'
        AND e.status = '在職';
    RETURN;
  END IF;

  IF v_snap.target_type = 'applicant_section_supervisor' THEN
    IF v_app.store_id IS NOT NULL THEN
      SELECT s.section_id INTO v_section_id FROM stores s WHERE s.id = v_app.store_id;
      IF v_section_id IS NOT NULL THEN
        SELECT ds.supervisor_id INTO v_target_emp_id
          FROM department_sections ds WHERE ds.id = v_section_id;
        IF v_target_emp_id IS NOT NULL THEN
          RETURN QUERY
            SELECT e.id, e.name,
              (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
              (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
            FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
        END IF;
      END IF;
    END IF;
    RETURN;
  END IF;

  -- ─────── specific_* ───────
  IF v_snap.target_type = 'specific_dept_manager' AND v_snap.target_dept_id IS NOT NULL THEN
    SELECT d.manager_id INTO v_target_emp_id FROM departments d WHERE d.id = v_snap.target_dept_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'specific_store_manager' AND v_snap.target_store_id IS NOT NULL THEN
    SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_snap.target_store_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'specific_section_supervisor' AND v_snap.target_section_id IS NOT NULL THEN
    SELECT ds.supervisor_id INTO v_target_emp_id
      FROM department_sections ds WHERE ds.id = v_snap.target_section_id;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  -- ─────── 商品調撥 5 個 dynamic target ───────
  IF v_snap.target_type IN ('transfer_in_store_manager', 'transfer_out_store_manager') THEN
    v_store_id := public._goods_transfer_target_store(p_request_id,
      CASE v_snap.target_type WHEN 'transfer_in_store_manager' THEN 'to' ELSE 'from' END);
    IF v_store_id IS NOT NULL THEN
      SELECT s.manager_id INTO v_target_emp_id FROM stores s WHERE s.id = v_store_id;
      IF v_target_emp_id IS NOT NULL THEN
        RETURN QUERY
          SELECT e.id, e.name,
            (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
            (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
          FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
      END IF;
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type IN ('transfer_in_store_supervisor', 'transfer_out_store_supervisor') THEN
    v_store_id := public._goods_transfer_target_store(p_request_id,
      CASE v_snap.target_type WHEN 'transfer_in_store_supervisor' THEN 'to' ELSE 'from' END);
    IF v_store_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e
        WHERE e.store_id = v_store_id
          AND e.position = '督導'
          AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  IF v_snap.target_type = 'warehouse_supervisor' THEN
    SELECT d.manager_id INTO v_target_emp_id
      FROM departments d
     WHERE d.name = '倉儲物流部'
       AND (v_app.organization_id IS NULL OR d.organization_id = v_app.organization_id)
     LIMIT 1;
    IF v_target_emp_id IS NOT NULL THEN
      RETURN QUERY
        SELECT e.id, e.name,
          (SELECT lt.line_user_id FROM _employee_line_target(e.id) lt LIMIT 1),
          (SELECT lt.channel_code  FROM _employee_line_target(e.id) lt LIMIT 1)
        FROM employees e WHERE e.id = v_target_emp_id AND e.status = '在職';
    END IF;
    RETURN;
  END IF;

  RETURN;
END $function$
;

-- ═══════════ restore_request(p_table text, p_id integer) ═══════════
CREATE OR REPLACE FUNCTION public.restore_request(p_table text, p_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_org INT;
  v_record_org INT;
  v_emp_id     INT;
BEGIN
  -- ★ 權限 guard：控管者或被授予「還原已刪除單據」者（補原本只檢查 org 的洞）
  IF NOT (current_employee_role() IN ('admin','super_admin','manager')
          OR public.current_user_can('hr_form.restore')) THEN
    RAISE EXCEPTION 'restore_request: permission denied (need hr_form.restore)';
  END IF;

  SELECT organization_id INTO v_caller_org
  FROM public.employees
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  CASE p_table

    WHEN 'leave_requests' THEN
      SELECT employee_id INTO v_emp_id FROM public.leave_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL THEN
        SELECT organization_id INTO v_record_org FROM public.employees WHERE id = v_emp_id;
        IF v_record_org IS DISTINCT FROM v_caller_org THEN
          RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
        END IF;
      END IF;
      UPDATE public.leave_requests SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'overtime_requests' THEN
      SELECT employee_id INTO v_emp_id FROM public.overtime_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL THEN
        SELECT organization_id INTO v_record_org FROM public.employees WHERE id = v_emp_id;
        IF v_record_org IS DISTINCT FROM v_caller_org THEN
          RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
        END IF;
      END IF;
      UPDATE public.overtime_requests SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'clock_corrections' THEN
      SELECT employee_id INTO v_emp_id FROM public.clock_corrections WHERE id = p_id;
      IF v_caller_org IS NOT NULL THEN
        SELECT organization_id INTO v_record_org FROM public.employees WHERE id = v_emp_id;
        IF v_record_org IS DISTINCT FROM v_caller_org THEN
          RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
        END IF;
      END IF;
      UPDATE public.clock_corrections SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'business_trips' THEN
      SELECT organization_id INTO v_record_org FROM public.business_trips WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.business_trips SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'headcount_requests' THEN
      SELECT organization_id INTO v_record_org FROM public.headcount_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.headcount_requests SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'expense_requests' THEN
      SELECT organization_id INTO v_record_org FROM public.expense_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.expense_requests SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'form_submissions' THEN
      SELECT organization_id INTO v_record_org FROM public.form_submissions WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.form_submissions SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'shift_swaps' THEN
      SELECT organization_id INTO v_record_org FROM public.shift_swaps WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.shift_swaps SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'off_requests' THEN
      SELECT organization_id INTO v_record_org FROM public.off_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.off_requests SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    ELSE
      RAISE EXCEPTION 'restore_request: unknown table %', p_table;
  END CASE;
END;
$function$
;

-- ═══════════ security_health_check() ═══════════
CREATE OR REPLACE FUNCTION public.security_health_check()
 RETURNS TABLE(severity text, category text, object text, detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH org_tables AS (
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id'
  ),
  pol AS (
    SELECT
      p.tablename, p.policyname, p.cmd, p.qual, p.with_check, p.roles,
      ('anon' = ANY(p.roles) OR 'public' = ANY(p.roles)) AS targets_anon,
      ('authenticated' = ANY(p.roles) OR 'public' = ANY(p.roles)) AS targets_auth,
      CASE p.cmd
        WHEN 'SELECT' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'SELECT')
        WHEN 'INSERT' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'INSERT')
        WHEN 'UPDATE' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'UPDATE')
        WHEN 'DELETE' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'DELETE')
        WHEN 'ALL'    THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'SELECT')
                        OR has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'INSERT')
        ELSE false
      END AS anon_has_grant,
      -- qual/with_check 是否「真的放行 anon」（true 或 null = 無過濾）
      CASE p.cmd
        WHEN 'SELECT' THEN p.qual = 'true'
        WHEN 'DELETE' THEN p.qual = 'true'
        WHEN 'UPDATE' THEN p.qual = 'true' OR p.with_check = 'true'
        WHEN 'INSERT' THEN p.with_check IS NULL OR p.with_check = 'true'
        WHEN 'ALL'    THEN p.qual = 'true' OR p.with_check = 'true'
                        OR (p.qual IS NULL AND p.with_check IS NULL)
        ELSE false
      END AS is_permissive
    FROM pg_policies p
    WHERE p.schemaname = 'public'
  )

  -- 1. 🔴 致命：anon 有 grant + 給 anon + qual/with_check 真的放行
  SELECT '🔴 致命(anon公網可達)'::text, 'anon直達'::text,
         (pol.tablename || ' / ' || pol.policyname)::text,
         ('cmd=' || pol.cmd || '  放行='
          || CASE pol.cmd WHEN 'INSERT' THEN COALESCE(left(pol.with_check,30),'NULL(無check)')
                          ELSE COALESCE(left(pol.qual,30),'NULL') END)::text
  FROM pol
  WHERE pol.targets_anon AND pol.anon_has_grant AND pol.is_permissive

  UNION ALL
  -- 2. 🟠 高：登入者跨租戶（USING(true) + authenticated 可達）
  SELECT '🟠 高(登入者跨租戶)', '完全開放USING(true)',
         (pol.tablename || ' / ' || pol.policyname),
         ('cmd=' || pol.cmd || ' — 任何登入者(不分org)全' ||
          CASE pol.cmd WHEN 'SELECT' THEN '看' ELSE '改' END)
  FROM pol
  WHERE pol.qual = 'true' AND pol.cmd IN ('SELECT', 'ALL')
    AND pol.targets_auth
    AND NOT (pol.targets_anon AND pol.anon_has_grant AND pol.is_permissive)

  UNION ALL
  -- 3. 🔴 致命：org 表沒 RLS 且 anon/authenticated 拿得到 grant（裸表）
  SELECT '🔴 致命(裸表無RLS)',
         CASE WHEN has_table_privilege('anon', ('public.'||c.relname)::regclass, 'SELECT')
              THEN '裸表-anon可讀' ELSE '裸表-登入者可讀' END,
         ('public.' || c.relname),
         '有 organization_id 但 RLS 未啟用 → 無任何過濾'
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    AND c.relname IN (SELECT table_name FROM org_tables)
    AND ( has_table_privilege('anon', c.oid, 'SELECT')
       OR has_table_privilege('authenticated', c.oid, 'SELECT') )

  UNION ALL
  -- 4. 🟡 中：SECURITY DEFINER + anon 可執行 + 收 p_org_id（確認內部有 org guard）
  SELECT '🟡 中(DEFINER繞RLS)', 'DEFINER+anon+org參數',
         (n.nspname || '.' || pr.proname),
         'SECURITY DEFINER 又給 anon、又收 p_org_id — 確認內部有 org guard'
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.prosecdef
    AND pr.proargnames @> ARRAY['p_org_id']
    AND has_function_privilege('anon', pr.oid, 'EXECUTE')

  UNION ALL
  -- 5. 🔵 低：anon 有 grant 但 qual 應已過濾（人工複查，留意含 "IS NULL" 的洩漏 null-org 列）
  SELECT '🔵 低(anon有grant待複查)', 'anon-qual應已過濾',
         (pol.tablename || ' / ' || pol.policyname),
         ('cmd=' || pol.cmd || '  qual=' || COALESCE(left(pol.qual,50),'NULL')
          || CASE WHEN pol.qual ILIKE '%is null%' THEN '  ⚠️含IS NULL' ELSE '' END)
  FROM pol
  WHERE pol.targets_anon AND pol.anon_has_grant AND NOT pol.is_permissive
    AND pol.cmd IN ('SELECT', 'ALL')
$function$
;

-- ═══════════ unlock_schedule_month(p_store_id integer, p_month text) ═══════════
CREATE OR REPLACE FUNCTION public.unlock_schedule_month(p_store_id integer, p_month text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role  TEXT;
  v_start DATE := (p_month || '-01')::date;
  v_end   DATE := ((p_month || '-01')::date + INTERVAL '1 month - 1 day')::date;
  v_count INT;
BEGIN
  SELECT role INTO v_role FROM employees
   WHERE auth_user_id = auth.uid()
      OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
   LIMIT 1;

  IF v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '只有管理員（admin/super_admin）可以解鎖月份排班';
  END IF;

  PERFORM set_config('schedules.bypass_lock', 'on', true);

  UPDATE schedules s SET status = 'draft'
   WHERE s.date BETWEEN v_start AND v_end
     AND s.employee IN (SELECT name FROM employees WHERE store_id = p_store_id)
     AND s.status = 'published';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM schedule_month_locks WHERE store_id = p_store_id AND month = p_month;

  RETURN jsonb_build_object('ok', true, 'unlocked_rows', v_count, 'month', p_month);
END $function$
;

