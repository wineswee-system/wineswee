-- 建立請假單 RPC(單一寫入路徑)— 2026-07-21 [階段3b/4]
-- web/LIFF/手機建假單一律走這支:讀 leave_types 規則 → leave_step_settings 解 step →
--   leave_calc_days_hours 算天數/時數 → leave_annual_entitlement 特休額度 → 驗證 → insert。
-- leave 在 DISABLED_TYPES → 簽核鏈/workflow/快照/通知由 DB trigger 自動,RPC 只需算+驗+插+回 row。
-- 驗證逐項對齊 leavePolicy.js validateLeaveRequest:性別 / 特休年資+額度(FT天·PT時) / maxDays上限 / 補休餘額。
-- ★ used(已用)以「當年度」計(特休/病假/事假等額度都是年度制;比舊前端「所有已載入」更正確)。
-- SECURITY DEFINER:繞 RLS 建單,與現有前端「任何登入者可代建」一致。

CREATE OR REPLACE FUNCTION public.create_leave_request(
  p_employee_id int,
  p_type_code   text,   -- leave_types.code, 如 'annual'
  p_unit        text,   -- 'day' | 'hour'
  p_start_date  date,
  p_end_date    date,
  p_start_time  time,
  p_end_time    time,
  p_reason      text DEFAULT NULL
) RETURNS public.leave_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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

  -- ── 特休:年資 + 額度 ──
  IF p_type_code = 'annual' THEN
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
END $$;

GRANT EXECUTE ON FUNCTION public.create_leave_request(int, text, text, date, date, time, time, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
