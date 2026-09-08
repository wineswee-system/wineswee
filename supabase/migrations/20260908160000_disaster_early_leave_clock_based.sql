-- 天災早退結算 v2:短少改用「打卡 vs 班表」的實際早退+遲到分鐘(不用淨工時差,免被休息扣法污染)
--   short = 早退(班表下班−打卡下班) + 遲到(打卡上班−班表上班),跨午夜安全,門檻 15 分。
--   days 補成 round(hours/8,2)(≥0.01) 以過 chk_leave_positive_days(days>0)。
--   只月薪、PT 跳過;idempotent;reason 保留「天災停班（type）」前綴(刪宣告一併清)。
CREATE OR REPLACE FUNCTION public.disaster_settle_early_leaves(
  p_disaster_id integer,
  p_employee_ids integer[] DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_d public.disaster_days;
  v_type text; v_start date; v_end date; v_cur date;
  v_cnt int := 0; r_emp RECORD; v_name text; v_org int;
  v_ss numeric; v_se numeric; v_ci numeric; v_co numeric;
  v_late numeric; v_early numeric; v_short numeric;
  v_preview jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_d FROM public.disaster_days WHERE id = p_disaster_id;
  IF v_d.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_d.no_show_handling = 'paid' THEN
    RETURN json_build_object('ok', true, 'created', 0, 'preview', '[]'::json, 'note', '照給薪,無需結算早退');
  END IF;
  v_type  := CASE v_d.no_show_handling WHEN 'annual_leave' THEN '特休' ELSE '天災假' END;
  v_start := COALESCE(v_d.start_at::date, v_d.date);
  v_end   := COALESCE(v_d.end_at::date,   v_d.date);
  IF NOT p_dry_run THEN PERFORM set_config('app.skip_chain_notify', 'true', true); END IF;

  FOR r_emp IN
    SELECT DISTINCT e.id, e.name, e.organization_id
      FROM public.attendance_records ar
      JOIN public.employees e ON e.id = ar.employee_id
      LEFT JOIN public.salary_structures ss ON ss.employee_id = e.id
     WHERE ar.date BETWEEN v_start AND v_end AND ar.clock_in IS NOT NULL
       AND (v_d.store_ids IS NULL OR ar.store_id = ANY(v_d.store_ids))
       AND COALESCE(ss.salary_type, 'monthly') = 'monthly'
       AND COALESCE(ss.employment_category, '') <> 'parttime'
  LOOP
    v_name := r_emp.name; v_org := r_emp.organization_id;
    v_cur := v_start;
    WHILE v_cur <= v_end LOOP
      -- 班表起訖(取當日上班班別;跨午夜 se+1440)
      SELECT EXTRACT(EPOCH FROM MIN(actual_start))/60,
             EXTRACT(EPOCH FROM MAX(actual_end))/60
        INTO v_ss, v_se
        FROM public.schedules
       WHERE employee_id = r_emp.id AND date = v_cur
         AND actual_start IS NOT NULL
         AND COALESCE(shift,'') NOT IN ('休','休息','例假','補休');
      IF v_ss IS NULL THEN v_cur := v_cur + 1; CONTINUE; END IF;      -- 當天沒排上班班別
      IF v_se <= v_ss THEN v_se := v_se + 1440; END IF;

      -- 打卡起訖(當日 min 進 / max 出;跨午夜 co+1440)
      SELECT EXTRACT(EPOCH FROM MIN(clock_in))/60,
             EXTRACT(EPOCH FROM MAX(clock_out))/60
        INTO v_ci, v_co
        FROM public.attendance_records
       WHERE employee_id = r_emp.id AND date = v_cur AND clock_in IS NOT NULL AND clock_out IS NOT NULL;
      IF v_ci IS NULL OR v_co IS NULL THEN v_cur := v_cur + 1; CONTINUE; END IF;  -- 缺卡不處理
      IF v_co <= v_ci THEN v_co := v_co + 1440; END IF;

      -- idempotent / 不疊其他核准假
      IF EXISTS (SELECT 1 FROM public.leave_requests WHERE employee_id=r_emp.id AND start_date=v_cur AND reason LIKE '天災停班%' AND deleted_at IS NULL)
        THEN v_cur := v_cur + 1; CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM public.leave_requests WHERE employee_id=r_emp.id AND status='已核准' AND start_date<=v_cur AND COALESCE(end_date,start_date)>=v_cur AND deleted_at IS NULL)
        THEN v_cur := v_cur + 1; CONTINUE; END IF;

      v_late  := GREATEST(0, v_ci - v_ss);   -- 遲到分
      v_early := GREATEST(0, v_se - v_co);    -- 早退分
      -- 請假以「半小時」為基準:短少時數吸附到最近的 0.5h(對齊 leave_requests 時數 trigger)
      v_short := round(((v_late + v_early) / 60.0) * 2) / 2.0;

      IF (v_late + v_early) < 15 THEN v_cur := v_cur + 1; CONTINUE; END IF;   -- <15分(不足半小時)視為誤差,不處理

      v_preview := v_preview || jsonb_build_object(
        'employee_id', r_emp.id, 'name', v_name, 'date', v_cur,
        'late_min', round(v_late), 'early_min', round(v_early), 'shortfall', v_short
      );

      IF NOT p_dry_run AND (p_employee_ids IS NULL OR r_emp.id = ANY(p_employee_ids)) THEN
        INSERT INTO public.leave_requests
          (employee_id, employee, type, start_date, end_date, days, hours,
           reason, status, organization_id, current_step, approved_at)
        VALUES
          (r_emp.id, v_name, v_type, v_cur, v_cur,
           GREATEST(round(v_short/8.0, 2), 0.01), v_short,
           '天災停班（' || v_d.disaster_type || '）早退短少自動產生', '已核准',
           COALESCE(v_org, v_d.organization_id), 0, now());
        v_cnt := v_cnt + 1;
      END IF;
      v_cur := v_cur + 1;
    END LOOP;
  END LOOP;
  RETURN json_build_object('ok', true, 'created', v_cnt, 'leave_type', v_type, 'preview', v_preview);
END $fn$;
