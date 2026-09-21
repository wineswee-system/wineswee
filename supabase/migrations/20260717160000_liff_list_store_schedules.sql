-- LIFF「我的班表」加「全店」檢視:回呼叫者「主要門市」全體同事的班(日期區間) — 2026-07-17
-- 對齊 liff_list_schedules 寫法(SECURITY DEFINER 繞 anon RLS);限日期區間避免全撈。
-- 同店判定:排班的員工(employee_id 優先、否則姓名)所屬 store_id = 呼叫者 store_id。
-- row_to_json(s.*) 含 s.employee(反正規化姓名)供前端分組。idempotent。

CREATE OR REPLACE FUNCTION public.liff_list_store_schedules(
  p_line_user_id text,
  p_start date,
  p_end date
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(row_to_json(s.*) ORDER BY s.date, s.employee), '[]'::json)
  FROM public.schedules s
  WHERE s.date >= p_start AND s.date <= p_end
    AND EXISTS (
      SELECT 1
      FROM public._liff_resolve_employee(p_line_user_id) me
      JOIN public.employees e
        ON (s.employee_id IS NOT NULL AND e.id = s.employee_id)
        OR (s.employee_id IS NULL AND e.name = s.employee)
      WHERE me.store_id IS NOT NULL
        AND e.store_id = me.store_id
    )
$function$;

GRANT EXECUTE ON FUNCTION public.liff_list_store_schedules(text, date, date) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
