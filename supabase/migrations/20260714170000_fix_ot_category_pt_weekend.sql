-- 修正 _ot_category：時薪(兼職)員工「當天有排上班班別」→ 平日 — 2026-07-14
-- 問題：原 fallback 對時薪/admin 一律「星期日=例假、星期六=休息日」猜,忽略實際班表。
--   門市 PT 本來就排週末(如潘琦 6/20 週六排「文-文心11-22」),被誤判休息日 ×2.0。
-- 修法：時薪分支先看當天班表 —— 有排上班班別(非例假/休息)→ weekday；只有「完全沒排班」才用星期幾 fallback。
-- 例假/休息/國定 判斷逐字保留(它們在時薪分支之前,不受影響;「休息日+上班」worked-on-restday 仍正確判 restday)。

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
