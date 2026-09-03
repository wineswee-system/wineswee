-- 修:liff_list_task_categories 讀不存在的 public.task_categories 表 → 42P01,LIFF 新增任務頁分類下拉壞掉。
-- task_categories 表從沒建、Web 也沒用;tasks.category 是自由文字。
-- 改成直接回 tasks.category 的相異值(id 用名字本身,對齊前端 {id,name} value=name)。
CREATE OR REPLACE FUNCTION public.liff_list_task_categories(p_line_user_id text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;
  RETURN COALESCE((
    SELECT json_agg(json_build_object('id', c, 'name', c) ORDER BY c)
    FROM (
      SELECT DISTINCT btrim(category) AS c
      FROM public.tasks
      WHERE category IS NOT NULL AND btrim(category) <> ''
        AND (organization_id = emp.organization_id OR organization_id IS NULL)
    ) x
  ), '[]'::json);
END $function$;
