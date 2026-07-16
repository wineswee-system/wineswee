-- 行事曆活動計薪比照:補「比照例假 / 比照休息日」— 2026-07-16
-- 承 20260716130000(比照國定假日)。國定假日走 _is_national_holiday;例假/休息日是加班費
-- 日別(§36),走 _ot_category。這裡讓 _ot_category 也認 store_events.pay_class。
-- 對象一樣天然收斂:_ot_category 只在該員當天有工時時被計薪引擎採用 → 沒上班不受影響。
--
-- ★ helper 集中「該員門市當天行事曆綁的計薪比照」,_ot_category 逐字保留 0714170000 版,
--   只在 _is_national_holiday 之後、時薪 fallback 之前插兩個 WHEN(增量,不重寫)。
-- 個人請假別(特休/病假/事假…)不在此:那是個人請假流程,非整店某天的日別。idempotent。

-- helper:該員工所屬門市、當天行事曆活動綁的 pay_class(多筆取最高倍率那筆)
CREATE OR REPLACE FUNCTION public._store_event_pay_class(p_emp_id int, p_date date)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT se.pay_class
  FROM public.store_events se
  JOIN public.employees e ON e.id = p_emp_id
  WHERE se.date = p_date
    AND se.store_id = e.store_id
    AND se.pay_class IS NOT NULL
  ORDER BY CASE se.pay_class
             WHEN 'weekly_off'       THEN 1   -- 例假出勤倍率最高
             WHEN 'national_holiday'  THEN 2
             WHEN 'restday'          THEN 3
             ELSE 4 END
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public._store_event_pay_class(int, date) TO authenticated, anon, service_role;

-- _ot_category:逐字保留 0714170000,只加兩個 store-event WHEN 分支
CREATE OR REPLACE FUNCTION public._ot_category(p_emp_id integer, p_date date, p_ot_category text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sc AS (
    SELECT string_agg(COALESCE(shift,''), ' ') AS shifts
    FROM public.schedules WHERE employee_id = p_emp_id AND date = p_date
  )
  SELECT CASE
    WHEN sc.shifts LIKE '%例假%' THEN 'weekly_off'
    WHEN sc.shifts LIKE '%休息%' THEN 'restday'
    WHEN public._is_national_holiday(p_emp_id, p_date) THEN 'holiday'
    -- ★ 行事曆活動綁「比照例假 / 比照休息日」(國定假日已在上一行 _is_national_holiday 涵蓋)
    WHEN public._store_event_pay_class(p_emp_id, p_date) = 'weekly_off' THEN 'weekly_off'
    WHEN public._store_event_pay_class(p_emp_id, p_date) = 'restday'    THEN 'restday'
    WHEN COALESCE((
      SELECT COALESCE(ss.salary_type,'')='hourly' OR COALESCE(ss.employment_category,'')='admin'
      FROM public.salary_structures ss WHERE ss.employee_id = p_emp_id LIMIT 1
    ), false)
      THEN CASE
             -- 時薪/admin：當天有排上班班別 → 平日(門市 PT 週末本來就上班,不套週末休息日/例假)
             WHEN btrim(COALESCE(sc.shifts, '')) <> '' THEN 'weekday'
             -- 完全沒排班 → 才用星期幾猜
             ELSE CASE extract(dow from p_date)::int WHEN 0 THEN 'weekly_off' WHEN 6 THEN 'restday' ELSE 'weekday' END
           END
    ELSE 'weekday'
  END
  FROM sc
$function$;

NOTIFY pgrst, 'reload schema';
