-- 2026-08-14 liff_insert_leave_request 謀職假:資格+每週2日上限(對齊web)
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

  -- 性別限制:女性專屬假別(生理假/產假/產檢假/哺乳)男性不可申請(對齊 create_leave_request)
  IF emp.gender = '男' AND EXISTS (
    SELECT 1 FROM public.leave_types lt WHERE lt.code = v_code AND lt.gender = 'female'
  ) THEN
    RAISE EXCEPTION '%僅限女性員工申請', COALESCE(v_ltname, v_type);
  END IF;

  v_unit := CASE WHEN NULLIF(p_payload->>'start_time','') IS NOT NULL THEN 'hour' ELSE 'day' END;
  -- 產假一律整天制:忽略時數,強制整天(前端時數鈕就算按了送來也當整天,不會壞資料)
  IF v_code = 'maternity' THEN v_unit := 'day'; END IF;

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
  -- 產假:days 用「曆日」(含例假,對齊web上限);hours 維持工作日基準(計薪半薪扣款讀 hours=實際工時)
  IF v_code = 'maternity' THEN
    v_days := (COALESCE((p_payload->>'end_date')::date, (p_payload->>'start_date')::date) - (p_payload->>'start_date')::date) + 1;
  END IF;

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

  -- ★ 產假:依情形(分娩/流產週數)上限 56/28/7/5(性平法),對齊 web create_leave_request。
  IF v_code = 'maternity' AND v_days > public.maternity_max_days(p_payload->>'maternity_type') THEN
    RAISE EXCEPTION '產假天數超過上限:此情形上限 % 天,本次申請 % 天(請確認分娩/流產情形)',
      public.maternity_max_days(p_payload->>'maternity_type'), round(v_days,1);
  END IF;

  -- ★ 謀職假(§16):限資遣預告期在職者;每星期不超過二日之工作時間(=16h),對齊 web。
  IF v_code = 'job_seeking' THEN
    IF NOT public._employee_job_seeking_eligible(emp.id) THEN
      RAISE EXCEPTION '謀職假限資遣預告期間員工申請';
    END IF;
    IF (SELECT COALESCE(SUM(COALESCE(hours, days*8)),0) FROM public.leave_requests
         WHERE employee_id = emp.id AND type IN ('謀職假','job_seeking')
           AND status NOT IN ('已拒絕','已退回','已駁回','已取消')
           AND date_trunc('week', start_date) = date_trunc('week', (p_payload->>'start_date')::date)
       ) + v_hours > 16 + 0.001 THEN
      RAISE EXCEPTION '謀職假每星期上限二日(16小時):本週(含本次)已超過,請分散到其他週';
    END IF;
  END IF;

  -- ★ 事件/法定假別上限(婚假8/病假30/事假14/家庭照顧假7/生理假12/陪產7/產檢7…):吃 leave_types.max_days,對齊 web。
  --   特休(annual)/補休(comp_time)/產假(maternity 自有情形上限)已各自把關,排除。本年度已用(待審核+已核准)+本次 > 上限 → 當場擋。
  IF v_code IS NOT NULL AND v_code NOT IN ('annual','comp_time','maternity') THEN
    DECLARE
      v_max  numeric;
      v_used numeric;
      v_ystart date := date_trunc('year', (now() AT TIME ZONE 'Asia/Taipei')::date)::date;
    BEGIN
      SELECT max_days INTO v_max FROM public.leave_types WHERE code = v_code;
      IF v_max IS NOT NULL AND v_max > 0 THEN
        SELECT COALESCE(SUM(days),0) INTO v_used
          FROM public.leave_requests
         WHERE employee_id = emp.id
           AND type IN (v_type, v_code, v_ltname)
           AND status NOT IN ('已拒絕','已退回','已駁回','已取消')
           AND start_date >= v_ystart;
        IF v_used + v_days > v_max + 0.001 THEN
          RAISE EXCEPTION '%已使用 % 天，年度上限 % 天，剩餘 % 天，不足申請 % 天（含待審核）',
            COALESCE(v_ltname, v_type), round(v_used,1), v_max,
            round(greatest(0, v_max - v_used),1), round(v_days,1);
        END IF;
      END IF;
    END;
  END IF;

  INSERT INTO public.leave_requests (
    employee_id, employee, type, start_date, end_date, days, hours,
    start_time, end_time, reason, status, organization_id, maternity_type
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
    emp.organization_id,
    CASE WHEN v_code='maternity' THEN NULLIF(p_payload->>'maternity_type','') ELSE NULL END
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
END $function$

