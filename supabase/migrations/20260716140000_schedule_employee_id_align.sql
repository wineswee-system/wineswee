-- 班表對齊:schedules.employee_id 回填 + LIFF 改用 id 優先姓名 fallback — 2026-07-16
-- 問題:系統排班寫入只寫 employee(姓名)、employee_id 全 null;liff_list_schedules 只靠姓名對,
--       名字有差(空格/錯字/改名/跨店同名)就漏看。
-- 做法:①回填 employee_id(只回填「姓名唯一」的,同名的留 null 避免對錯人)
--       ②liff_list_schedules 改 employee_id 優先、employee_id null 時才 fallback 姓名。
-- idempotent。

-- ① 回填 employee_id(姓名在 employees 唯一才回填)
UPDATE public.schedules s
   SET employee_id = e.id
  FROM public.employees e
 WHERE s.employee_id IS NULL
   AND s.employee = e.name
   AND (SELECT COUNT(*) FROM public.employees e2 WHERE e2.name = s.employee) = 1;

-- ② LIFF 我的班表:id 優先、null 才 fallback 姓名
CREATE OR REPLACE FUNCTION public.liff_list_schedules(p_line_user_id text, p_month text DEFAULT NULL::text)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(row_to_json(s.*) ORDER BY s.date), '[]'::json)
  FROM public.schedules s
  WHERE EXISTS (
    SELECT 1 FROM public._liff_resolve_employee(p_line_user_id) me
     WHERE s.employee_id = me.id
        OR (s.employee_id IS NULL AND s.employee = me.name)
  )
    AND (p_month IS NULL OR to_char(s.date, 'YYYY-MM') = p_month)
$function$;

NOTIFY pgrst, 'reload schema';
