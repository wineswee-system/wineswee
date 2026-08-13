-- 2026-08-12 v2 修正 v1(20260812130000)兩個漏洞:
-- (1) §38 6個月閘門原本在 balance 檢查「之前」無條件跑 → 有 104 餘額但 §38 算 0 的人(PT王澤昇 pt_hours=0,
--     其 15h 是刻意算掛的)會被誤擋「未滿6個月」。→ 閘門移進「無 104 餘額」的 fallback 分支。
-- (2) v1 只判 v_bal_total IS NOT NULL,但有人 total_days=0(NOT NULL)→ 上限算成 0h 卡死。
--     → 改判 v_bal_total > 0 才吃 104;<=0 視為「無真正匯入值」→ fallback §38(=改動前原行為)。
-- 淨效果:有 104 實際餘額(>0)的人吃 104(含隱含資格,不套§38閘門);其餘完全維持 §38 原行為。

-- ─────────────────────────────────────────────────────────────
-- 1) web 後端:create_leave_request
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_leave_request(p_employee_id integer, p_type_code text, p_unit text, p_start_date date, p_end_date date, p_start_time time without time zone, p_end_time time without time zone, p_reason text DEFAULT NULL::text, p_attachment_count integer DEFAULT 0)
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

  -- 算天數/時數(單一來源)
  v_calc  := public.leave_calc_days_hours(p_unit, p_start_date, p_end_date, p_start_time, p_end_time, v_step, v_step_unit);
  v_days  := (v_calc->>'days')::numeric;
  v_hours := (v_calc->>'hours')::numeric;
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
       AND l.status NOT IN ('已拒絕','已取消')
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
    start_time, end_time, days, hours, reason, status, organization_id
  ) VALUES (
    v_emp.name, v_emp.id, v_lt.short_name, p_start_date, v_end_date,
    CASE WHEN p_unit='hour' THEN p_start_time ELSE NULL END,
    CASE WHEN p_unit='hour' THEN p_end_time ELSE NULL END,
    v_days, v_hours, p_reason, '待審核', v_emp.organization_id
  ) RETURNING * INTO v_row;

  RETURN v_row;
END $function$;

-- ─────────────────────────────────────────────────────────────
-- 2) LIFF 後端:liff_insert_leave_request
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_insert_leave_request(p_line_user_id text, p_payload json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
  new_id int;
  v_type TEXT;          -- 短名(如 '補休')
  v_code TEXT;
  v_ltname TEXT;
  v_unit TEXT;
  v_step numeric;
  v_step_unit text;
  v_calc json;
  v_days numeric;
  v_hours NUMERIC;
  v_deduct JSON;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  v_type := p_payload->>'type';

  -- 反查 code(payload 傳短名)→ 解 step
  SELECT code, name INTO v_code, v_ltname FROM public.leave_types
   WHERE short_name = v_type OR name = v_type OR code = v_type LIMIT 1;

  -- 證明必附:病/喪/婚/產/陪產/產檢/育嬰/公傷病 沒附附件擋下(對齊 web,單一來源 _leave_requires_proof)
  IF public._leave_requires_proof(v_code) AND COALESCE((p_payload->>'attachment_count')::int, 0) = 0 THEN
    RAISE EXCEPTION '%需附上證明（診斷書／相關文件），以免被駁回。請上傳附件後再送出。', COALESCE(v_ltname, v_type);
  END IF;

  v_unit := CASE WHEN NULLIF(p_payload->>'start_time','') IS NOT NULL THEN 'hour' ELSE 'day' END;

  IF v_code IS NOT NULL THEN
    SELECT step, unit INTO v_step, v_step_unit
      FROM public.leave_step_settings WHERE leave_code = v_code AND store_id = emp.store_id LIMIT 1;
    IF v_step IS NULL THEN
      SELECT step, unit INTO v_step, v_step_unit
        FROM public.leave_step_settings WHERE leave_code = v_code AND store_id IS NULL LIMIT 1;
    END IF;
    IF v_step IS NULL THEN
      SELECT min_unit, unit INTO v_step, v_step_unit FROM public.leave_types WHERE code = v_code;
    END IF;
  END IF;
  IF v_step IS NULL THEN
    v_step := 0.5; v_step_unit := CASE WHEN v_unit = 'hour' THEN 'hour' ELSE 'day' END;
  END IF;

  -- ★ 後端算天數/時數(單一來源,忽略 client 送的 days/hours)
  v_calc := public.leave_calc_days_hours(
    v_unit,
    (p_payload->>'start_date')::date,
    COALESCE((p_payload->>'end_date')::date, (p_payload->>'start_date')::date),
    NULLIF(p_payload->>'start_time','')::time,
    NULLIF(p_payload->>'end_time','')::time,
    v_step, v_step_unit
  );
  v_days  := (v_calc->>'days')::numeric;
  v_hours := (v_calc->>'hours')::numeric;

  -- 補休前置 guard(用後端算的 hours;邏輯不變)
  IF v_type = '補休' THEN
    IF v_hours IS NULL OR v_hours <= 0 THEN
      RAISE EXCEPTION 'comp_time hours invalid';
    END IF;
    DECLARE
      v_avail NUMERIC;
    BEGIN
      SELECT COALESCE(SUM(hours - hours_used), 0) INTO v_avail
        FROM comp_time_ledger
       WHERE employee_id = emp.id AND status = 'active';
      IF v_avail < v_hours THEN
        RAISE EXCEPTION '補休餘額不足：剩 % 小時，需請 % 小時', v_avail, v_hours;
      END IF;
    END;
  END IF;

  -- 特休:餘額改吃 leave_balances(104匯入單一來源;有實際餘額>0才用,含隱含資格;
  --       否則 fallback §38 6個月閘門+曆年額度=改動前原行為)
  IF v_code = 'annual' THEN
    DECLARE
      v_ent json;
      v_is_pt boolean := (emp.salary_type = 'hourly');
      v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
      v_year_start date := date_trunc('year', (now() AT TIME ZONE 'Asia/Taipei')::date)::date;
      v_bal_total numeric; v_bal_used numeric; v_bal_ps date; v_bal_ex date;
      v_remain_h numeric; v_pending_h numeric; v_req_h numeric;
      v_used_days numeric; v_used_hours numeric;
    BEGIN
      -- 現在期(週年期含今天)leave_balances
      SELECT total_days, used_days, period_start, expires_at
        INTO v_bal_total, v_bal_used, v_bal_ps, v_bal_ex
        FROM public.leave_balances
       WHERE employee_id = emp.id AND leave_type = 'annual'
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
         WHERE employee_id = emp.id
           AND type IN (v_type, v_code, v_ltname)
           AND status = '待審核'
           AND (v_bal_ps IS NULL OR start_date >= v_bal_ps)
           AND (v_bal_ex IS NULL OR start_date <= v_bal_ex);
        IF v_req_h > (v_remain_h - v_pending_h) + 0.01 THEN
          RAISE EXCEPTION '特休餘額不足：本期剩 %h，待審核 %h，可再請 %h，本次申請 %h',
            round(v_remain_h,1), round(v_pending_h,1),
            round(greatest(0, v_remain_h - v_pending_h),1), round(v_req_h,1);
        END IF;
      ELSE
        -- 無 104 實際餘額 → §38 6個月閘門 + 曆年額度(原行為)
        v_ent := public.leave_annual_entitlement(emp.id);
        IF (v_ent->>'ft_days')::int = 0 AND COALESCE((v_ent->>'pt_hours')::numeric,0) = 0 THEN
          RAISE EXCEPTION '未滿 6 個月年資（目前 % 年），尚無特休資格', v_ent->>'years_worked';
        END IF;
        SELECT COALESCE(SUM(days),0), COALESCE(SUM(COALESCE(hours, days*8)),0)
          INTO v_used_days, v_used_hours
          FROM public.leave_requests
         WHERE employee_id = emp.id
           AND type IN (v_type, v_code, v_ltname)
           AND status NOT IN ('已拒絕','已退回','已取消')
           AND start_date >= v_year_start;
        IF v_is_pt THEN
          IF v_used_hours + v_hours > (v_ent->>'pt_hours')::numeric THEN
            RAISE EXCEPTION '特休餘額不足：年度 %h，已用 %h，不足申請 %h',
              round((v_ent->>'pt_hours')::numeric,1), round(v_used_hours,1), v_hours;
          END IF;
        ELSE
          IF v_used_days + v_days > (v_ent->>'ft_days')::numeric THEN
            RAISE EXCEPTION '特休餘額不足：年度 % 天，已用 % 天，不足申請 % 天',
              (v_ent->>'ft_days')::numeric, v_used_days, v_days;
          END IF;
        END IF;
      END IF;
    END;
  END IF;

  INSERT INTO public.leave_requests (
    employee_id, employee, type, start_date, end_date, days, hours,
    start_time, end_time, reason, status, organization_id
  )
  VALUES (
    emp.id, emp.name, v_type,
    (p_payload->>'start_date')::date,
    CASE WHEN v_unit = 'hour' THEN (p_payload->>'start_date')::date
         ELSE COALESCE((p_payload->>'end_date')::date, (p_payload->>'start_date')::date) END,
    v_days, v_hours,
    CASE WHEN v_unit = 'hour' THEN NULLIF(p_payload->>'start_time','')::time ELSE NULL END,
    CASE WHEN v_unit = 'hour' THEN NULLIF(p_payload->>'end_time','')::time ELSE NULL END,
    p_payload->>'reason',
    COALESCE(p_payload->>'status', '待審核'),
    emp.organization_id
  )
  RETURNING id INTO new_id;

  -- 補休:同 txn 扣 ledger(不變)
  IF v_type = '補休' THEN
    v_deduct := public.deduct_comp_time(new_id, emp.id, v_hours);
    IF NOT COALESCE((v_deduct->>'ok')::BOOLEAN, false) THEN
      RAISE EXCEPTION '補休扣帳失敗：%', v_deduct;
    END IF;
  END IF;

  RETURN json_build_object('id', new_id);
END $function$;
