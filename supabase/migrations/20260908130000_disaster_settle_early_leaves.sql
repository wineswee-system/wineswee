-- 天災結算:有來但「早退/短少工時」的月薪員工,把短少時數用「天災假」名義扣(不當早退)
--   機制:建一張 已核准 的天災假單(start=end=當天, days=0, hours=短少)
--     → 計薪引擎 (_compute_payroll_for_employee) 會:
--        ① 該日有核准請假 → 不再算遲到/早退(避免雙重扣)
--        ② 請假扣款區含 '天災假' 型別、用 lr.hours 扣 → 短少時數以天災無薪假扣
--   只處理「月薪」:月薪本薪固定,早退本來被當早退扣 → 改天災假名義。
--   PT/時薪跳過:本薪=時薪×實做工時,已只領實做的錢,再建假單會雙重扣。
--   短少 = _scheduled_net_hours(當日排班淨工時) − 實際工時(attendance total_hours)。
--   idempotent:當日已有天災停班單 / 其他核准假 → 跳過;reason 保留「天災停班（type）」前綴,刪宣告時一併軟刪。
--   p_dry_run=true → 只回預覽清單不寫入。

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
  v_d       public.disaster_days;
  v_type    text;
  v_start   date;
  v_end     date;
  v_cur     date;
  v_cnt     int := 0;
  r_emp     RECORD;
  v_sched   numeric;
  v_actual  numeric;
  v_short   numeric;
  v_name    text;
  v_org     int;
  v_preview jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_d FROM public.disaster_days WHERE id = p_disaster_id;
  IF v_d.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  -- 照給薪的天災 → 早退也不扣,無需產單
  IF v_d.no_show_handling = 'paid' THEN
    RETURN json_build_object('ok', true, 'created', 0, 'preview', '[]'::json, 'note', '照給薪,無需結算早退');
  END IF;

  v_type  := CASE v_d.no_show_handling WHEN 'annual_leave' THEN '特休' ELSE '天災假' END;
  v_start := COALESCE(v_d.start_at::date, v_d.date);
  v_end   := COALESCE(v_d.end_at::date,   v_d.date);

  IF NOT p_dry_run THEN PERFORM set_config('app.skip_chain_notify', 'true', true); END IF;

  -- 掃「天災區間內有打卡、月薪」的員工(限宣告門市)
  FOR r_emp IN
    SELECT DISTINCT e.id, e.name, e.organization_id
      FROM public.attendance_records ar
      JOIN public.employees e ON e.id = ar.employee_id
      LEFT JOIN public.salary_structures ss ON ss.employee_id = e.id
     WHERE ar.date BETWEEN v_start AND v_end
       AND ar.clock_in IS NOT NULL
       AND (v_d.store_ids IS NULL OR ar.store_id = ANY(v_d.store_ids))
       -- 只月薪;PT/時薪/計件跳過(本薪已依實做工時,不能再扣)
       AND COALESCE(ss.salary_type, 'monthly') = 'monthly'
       AND COALESCE(ss.employment_category, '') <> 'parttime'
  LOOP
    v_name := r_emp.name; v_org := r_emp.organization_id;
    v_cur := v_start;
    WHILE v_cur <= v_end LOOP
      -- 當天要有上班班別
      IF NOT EXISTS (
        SELECT 1 FROM public.schedules s
         WHERE s.employee_id = r_emp.id AND s.date = v_cur
           AND s.actual_start IS NOT NULL
           AND COALESCE(s.shift,'') NOT IN ('休','休息','例假','補休')
      ) THEN v_cur := v_cur + 1; CONTINUE; END IF;

      -- 當天要有打卡(有來才叫早退)
      IF NOT EXISTS (
        SELECT 1 FROM public.attendance_records ar
         WHERE ar.employee_id = r_emp.id AND ar.date = v_cur AND ar.clock_in IS NOT NULL
      ) THEN v_cur := v_cur + 1; CONTINUE; END IF;

      -- 當天已有天災停班單 → 跳過(idempotent)
      IF EXISTS (
        SELECT 1 FROM public.leave_requests
         WHERE employee_id = r_emp.id AND start_date = v_cur
           AND reason LIKE '天災停班%' AND deleted_at IS NULL
      ) THEN v_cur := v_cur + 1; CONTINUE; END IF;

      -- 當天已有其他核准請假 → 跳過(不疊)
      IF EXISTS (
        SELECT 1 FROM public.leave_requests
         WHERE employee_id = r_emp.id AND status = '已核准'
           AND start_date <= v_cur AND COALESCE(end_date, start_date) >= v_cur AND deleted_at IS NULL
      ) THEN v_cur := v_cur + 1; CONTINUE; END IF;

      v_sched  := COALESCE(public._scheduled_net_hours(r_emp.id, v_cur), 0);
      SELECT COALESCE(SUM(total_hours), 0) INTO v_actual
        FROM public.attendance_records
       WHERE employee_id = r_emp.id AND date = v_cur AND clock_in IS NOT NULL;
      v_short := round(v_sched - v_actual, 2);

      -- 短少 < 0.5h 視為誤差,不處理
      IF v_short < 0.5 THEN v_cur := v_cur + 1; CONTINUE; END IF;

      v_preview := v_preview || jsonb_build_object(
        'employee_id', r_emp.id, 'name', v_name, 'date', v_cur,
        'scheduled', v_sched, 'actual', v_actual, 'shortfall', v_short
      );

      -- 實際寫入:限勾選名單(p_employee_ids 為 NULL 視為全部)
      IF NOT p_dry_run AND (p_employee_ids IS NULL OR r_emp.id = ANY(p_employee_ids)) THEN
        INSERT INTO public.leave_requests
          (employee_id, employee, type, start_date, end_date, days, hours,
           reason, status, organization_id, current_step, approved_at)
        VALUES
          (r_emp.id, v_name, v_type, v_cur, v_cur, 0, v_short,
           '天災停班（' || v_d.disaster_type || '）早退短少自動產生', '已核准',
           COALESCE(v_org, v_d.organization_id), 0, now());
        v_cnt := v_cnt + 1;
      END IF;

      v_cur := v_cur + 1;
    END LOOP;
  END LOOP;

  RETURN json_build_object('ok', true, 'created', v_cnt, 'leave_type', v_type, 'preview', v_preview);
END $fn$;

REVOKE ALL ON FUNCTION public.disaster_settle_early_leaves(integer, integer[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disaster_settle_early_leaves(integer, integer[], boolean) TO authenticated;
