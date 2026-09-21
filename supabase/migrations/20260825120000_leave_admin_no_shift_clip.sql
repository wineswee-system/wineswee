-- 時數假(有起訖時間)淨時數:行政職(admin)修正。
-- 問題:行政職沒排班時,_shift_break_context 回「名目辦公窗 09:00~18:00」,
--   _leave_net_minutes 拿它去切請假時段 → 自填 16:13~18:13(2h)被砍成 16:13~18:00=1.8h。
--   而該員實際打卡 09:12~16:16,根本不是上到 18:00,名目窗不該拿來切。
-- 修法:行政職改用「自填請假時段本身」當範圍(不砍尾巴/頭),只扣落在請假內的午休。
--   門市/一般職照真實班表 clip 不變(_shift_break_context 非 admin 分支)。
CREATE OR REPLACE FUNCTION public._leave_net_hours(p_emp_id integer, p_date date, p_leave_start time without time zone, p_leave_end time without time zone)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ctx record; v_admin boolean;
BEGIN
  SELECT COALESCE(ss.employment_category,'') = 'admin' INTO v_admin
    FROM public.employees e LEFT JOIN public.salary_structures ss ON ss.employee_id = e.id
   WHERE e.id = p_emp_id;
  SELECT * INTO ctx FROM public._shift_break_context(p_emp_id, p_date);
  IF ctx.shift_start IS NULL THEN RETURN NULL; END IF;
  -- 行政職:辦公窗(預設09~18)只是名目上下班,不拿它切請假時段(尊重自填時段);只扣落在請假內的午休。
  IF v_admin THEN
    RETURN public._leave_net_minutes(p_leave_start, p_leave_end, ctx.break_start, ctx.break_end,
                                     p_leave_start, p_leave_end) / 60.0;
  END IF;
  RETURN public._leave_net_minutes(ctx.shift_start, ctx.shift_end, ctx.break_start, ctx.break_end,
                                   p_leave_start, p_leave_end) / 60.0;
END $function$;
