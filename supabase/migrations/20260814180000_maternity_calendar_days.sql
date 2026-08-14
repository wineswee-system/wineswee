-- 2026-08-14 產假:曆日計+情形上限+一律整天制(忽略時數,前端關時數+此後端保險)
DROP FUNCTION IF EXISTS public.create_leave_request(integer, text, text, date, date, time without time zone, time without time zone, text, integer, text);

CREATE OR REPLACE FUNCTION public.create_leave_request(p_employee_id integer, p_type_code text, p_unit text, p_start_date date, p_end_date date, p_start_time time without time zone, p_end_time time without time zone, p_reason text DEFAULT NULL::text, p_attachment_count integer DEFAULT 0, p_maternity_type text DEFAULT NULL::text)
 RETURNS leave_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp   public.employees;
  v_lt    public.leave_types;
  v_step  numeric;
  v_step_unit text;
  v_calc  json;
  v_days  numeric;
  v_hours numeric;
  v_is_pt boolean;
  v_ent   json;
  v_extra numeric := 0;
  v_used_days  numeric;
  v_used_hours numeric;
  v_year_start date := date_trunc('year', now())::date;
  v_comp_bal   numeric;
  v_end_date   date;
  v_row  public.leave_requests;
  -- 特休餘額改吃 leave_balances(104)所需
  v_today    date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_bal_total numeric; v_bal_used numeric; v_bal_ps date; v_bal_ex date;
  v_remain_h numeric; v_pending_h numeric; v_req_h numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_employee_id IS NULL OR p_type_code IS NULL OR p_start_date IS NULL THEN
    RAISE EXCEPTION '缺少必填欄位(員工/假別/開始日)';
  END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN RAISE EXCEPTION '查無此員工'; END IF;

  SELECT * INTO v_lt FROM public.leave_types WHERE code = p_type_code AND is_active;
  IF v_lt.id IS NULL THEN RAISE EXCEPTION '無效的假別: %', p_type_code; END IF;

  -- 性別限制
  IF v_lt.gender = 'female' AND v_emp.gender = '男' THEN
    RAISE EXCEPTION '%僅限女性員工申請', v_lt.name;
  END IF;

  -- 證明必附:病/喪/婚/產/陪產/產檢/育嬰/公傷病 沒附附件擋下(單一來源 _leave_requires_proof)
  IF public._leave_requires_proof(p_type_code) AND COALESCE(p_attachment_count, 0) = 0 THEN
    RAISE EXCEPTION '%需附上證明（診斷書／相關文件），以免被駁回。請上傳附件後再送出。', v_lt.name;
  END IF;

  -- 解 step(門市覆寫 → 全公司 → 假別預設 min_unit)
  SELECT step, unit INTO v_step, v_step_unit
    FROM public.leave_step_settings
   WHERE leave_code = p_type_code AND store_id = v_emp.store_id
   LIMIT 1;
  IF v_step IS NULL THEN
    SELECT step, unit INTO v_step, v_step_unit
      FROM public.leave_step_settings
     WHERE leave_code = p_type_code AND store_id IS NULL
     LIMIT 1;
  END IF;
  IF v_step IS NULL THEN v_step := v_lt.min_unit; v_step_unit := v_lt.unit; END IF;

  -- 產假一律整天制(法律以日計,含例假曆日):忽略前端送的時數,強制整天(前端已關時數,這是保險)
  IF p_type_code = 'maternity' THEN
    p_unit := 'day'; p_start_time := NULL; p_end_time := NULL;
  END IF;

  -- 算天數/時數(單一來源)
  v_calc  := public.leave_calc_days_hours(p_unit, p_start_date, p_end_date, p_start_time, p_end_time, v_step, v_step_unit);
  v_days  := (v_calc->>'days')::numeric;
  v_hours := (v_calc->>'hours')::numeric;
  -- 產假:days 用「曆日」(含例假/國假,對齊§50上限56/28/7/5);hours 維持工作日基準不動
  --   (計薪§50未滿6月半薪扣款讀 lr.hours,要的是實際工作時數非曆日,故 hours 不改)
  IF p_type_code = 'maternity' THEN
    v_days := (p_end_date - p_start_date) + 1;
  END IF;
  IF COALESCE(v_days,0) <= 0 AND COALESCE(v_hours,0) <= 0 THEN
    RAISE EXCEPTION '請假時數/天數計算為 0,請檢查日期或時間';
  END IF;

  v_is_pt := (v_emp.salary_type = 'hourly');

  -- 假別加給(extra_days):benefit_policies 目前為空表、欄位結構未定 → 先固定 0(=現況,沒人設加給)。
  -- TODO:等 benefit_policies 真的啟用假別加給時,依其實際欄位接進來(對齊 benefitPolicy.getEffectiveBenefits)。
  v_extra := 0;

  -- 當年度已用(同員工同假別,排除已拒絕/取消)
  SELECT COALESCE(SUM(days),0), COALESCE(SUM(COALESCE(hours, days*8)),0)
    INTO v_used_days, v_used_hours
    FROM public.leave_requests
   WHERE employee_id = v_emp.id
     AND (type = p_type_code OR type = v_lt.short_name OR type = v_lt.name)
     AND status NOT IN ('已拒絕','已退回','已取消')
     AND start_date >= v_year_start;

  -- ── 補休:查餘額 ──
  IF p_type_code = 'comp_time' THEN
    SELECT COALESCE(SUM(hours_remaining),0) INTO v_comp_bal
      FROM public.get_comp_time_balance(v_emp.id);
    IF v_comp_bal < v_hours THEN
      RAISE EXCEPTION '補休餘額不足:剩 % 小時,本次要請 % 小時', v_comp_bal, v_hours;
    END IF;
  END IF;

  -- ── 特休:餘額改吃 leave_balances(104匯入單一來源;有實際餘額>0才用,含隱含資格;
  --         否則 fallback §38 6個月閘門+曆年額度=改動前原行為) ──
  IF p_type_code = 'annual' THEN
    -- 現在期(週年期含今天)leave_balances
    SELECT total_days, used_days, period_start, expires_at
      INTO v_bal_total, v_bal_used, v_bal_ps, v_bal_ex
      FROM public.leave_balances
     WHERE employee_id = v_emp.id AND leave_type = 'annual'
       AND (period_start IS NULL OR period_start <= v_today)
       AND (expires_at  IS NULL OR expires_at  >= v_today)
     ORDER BY period_start DESC NULLS LAST
     LIMIT 1;
    v_req_h := COALESCE(v_hours, v_days * 8);
    IF v_bal_total IS NOT NULL AND v_bal_total > 0 THEN
      -- 104 為真相:上限=剩餘;扣本期在飛「待審核」特休(尚未計入 used_days)。不套 §38 閘門。
      v_remain_h := (v_bal_total - COALESCE(v_bal_used,0)) * 8;
      SELECT COALESCE(SUM(COALESCE(hours, days*8)),0) INTO v_pending_h
        FROM public.leave_requests
       WHERE employee_id = v_emp.id
         AND (type = p_type_code OR type = v_lt.short_name OR type = v_lt.name)
         AND status = '待審核'
         AND (v_bal_ps IS NULL OR start_date >= v_bal_ps)
         AND (v_bal_ex IS NULL OR start_date <= v_bal_ex);
      IF v_req_h > (v_remain_h - v_pending_h) + 0.01 THEN
        RAISE EXCEPTION '特休餘額不足:本期剩 %h,待審核 %h,可再請 %h,本次申請 %h',
          round(v_remain_h,1), round(v_pending_h,1),
          round(greatest(0, v_remain_h - v_pending_h),1), round(v_req_h,1);
      END IF;
    ELSE
      -- 無 104 實際餘額 → §38 6個月閘門 + 曆年額度(原行為)
      v_ent := public.leave_annual_entitlement(v_emp.id);
      IF (v_ent->>'ft_days')::int = 0 AND COALESCE((v_ent->>'pt_hours')::numeric,0) = 0 THEN
        RAISE EXCEPTION '未滿 6 個月年資(目前 % 年),尚無特休資格', v_ent->>'years_worked';
      END IF;
      IF v_is_pt THEN
        IF v_used_hours + v_hours > (v_ent->>'pt_hours')::numeric THEN
          RAISE EXCEPTION '特休餘額不足:年度 %h,已用 %h,不足申請 %h',
            round((v_ent->>'pt_hours')::numeric,1), round(v_used_hours,1), v_hours;
        END IF;
      ELSE
        IF v_used_days + v_days > ((v_ent->>'ft_days')::numeric + v_extra) THEN
          RAISE EXCEPTION '特休餘額不足:年度 % 天,已用 % 天,不足申請 % 天',
            (v_ent->>'ft_days')::numeric + v_extra, v_used_days, v_days;
        END IF;
      END IF;
    END IF;
  -- ── 產假:依情形(分娩/流產週數)上限 56/28/7/5(性平法) ──
  ELSIF p_type_code = 'maternity' THEN
    IF v_days > public.maternity_max_days(p_maternity_type) THEN
      RAISE EXCEPTION '產假天數超過上限:此情形上限 % 天,本次申請 % 天(請確認分娩/流產情形)',
        public.maternity_max_days(p_maternity_type), v_days;
    END IF;
  -- ── 其他有 maxDays 上限的假別 ──
  ELSIF v_lt.max_days IS NOT NULL THEN
    IF v_used_days + v_days > (v_lt.max_days + v_extra) THEN
      RAISE EXCEPTION '%已用 % 天,上限 % 天,不足申請 % 天',
        v_lt.name, v_used_days, v_lt.max_days + v_extra, v_days;
    END IF;
  END IF;

  -- ── 日期重疊(同員工,未拒絕/取消的假單)──
  IF EXISTS (
    SELECT 1 FROM public.leave_requests l
     WHERE l.employee_id = v_emp.id
       AND l.status NOT IN ('已拒絕','已駁回','已退回','已取消')
       AND l.deleted_at IS NULL
       AND daterange(l.start_date, COALESCE(l.end_date, l.start_date), '[]')
           && daterange(p_start_date, COALESCE(p_end_date, p_start_date), '[]')
  ) THEN
    RAISE EXCEPTION '日期與已申請的假單重疊';
  END IF;

  -- 時數假收在 start_date(不跨天)
  v_end_date := CASE WHEN p_unit = 'hour' THEN p_start_date ELSE COALESCE(p_end_date, p_start_date) END;

  INSERT INTO public.leave_requests (
    employee, employee_id, type, start_date, end_date,
    start_time, end_time, days, hours, reason, status, organization_id, maternity_type
  ) VALUES (
    v_emp.name, v_emp.id, v_lt.short_name, p_start_date, v_end_date,
    CASE WHEN p_unit='hour' THEN p_start_time ELSE NULL END,
    CASE WHEN p_unit='hour' THEN p_end_time ELSE NULL END,
    v_days, v_hours, p_reason, '待審核', v_emp.organization_id,
    CASE WHEN p_type_code='maternity' THEN p_maternity_type ELSE NULL END
  ) RETURNING * INTO v_row;

  RETURN v_row;
END $function$

