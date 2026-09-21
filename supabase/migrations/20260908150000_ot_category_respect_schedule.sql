-- 修:_ot_category 對「時薪(PT)/admin」用星期幾判例假/休息,忽略了「當天其實有排班上班」
--   → PT 月制排班、週末照上班,卻被週日判例假(×2)、週六判休息(×2),加班費灌高。
-- 正解:當天有排「上班班別」→ 一律 weekday(平日OT);只有那天沒排上班班別時,才退回用星期猜。
--   順序:班表明寫例假/休息 → 國定假 → 有上班班別=weekday → (PT/admin且無班)用星期猜 → weekday。
--   FT/正職原本就不走星期分支,行為不變。
CREATE OR REPLACE FUNCTION public._ot_category(p_emp_id integer, p_date date, p_ot_category text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sc AS (
    SELECT string_agg(COALESCE(shift,''), ' ') AS shifts,
           bool_or(actual_start IS NOT NULL
                   AND COALESCE(shift,'') NOT IN ('休','休息','例假','補休')) AS has_work
    FROM public.schedules WHERE employee_id = p_emp_id AND date = p_date
  )
  SELECT CASE
    WHEN sc.shifts LIKE '%例假%' THEN 'weekly_off'
    WHEN sc.shifts LIKE '%休息%' THEN 'restday'
    WHEN public._is_national_holiday(p_emp_id, p_date) THEN 'holiday'
    -- ★ 當天有排上班班別 → 平日OT(不再用星期覆蓋);修 PT/admin 週末上班被誤判例假/休息
    WHEN COALESCE(sc.has_work, false) THEN 'weekday'
    WHEN COALESCE((
      SELECT COALESCE(ss.salary_type,'')='hourly' OR COALESCE(ss.employment_category,'')='admin'
      FROM public.salary_structures ss WHERE ss.employee_id = p_emp_id LIMIT 1
    ), false)
      THEN CASE extract(dow from p_date)::int WHEN 0 THEN 'weekly_off' WHEN 6 THEN 'restday' ELSE 'weekday' END
    ELSE 'weekday'
  END
  FROM sc
$function$;
