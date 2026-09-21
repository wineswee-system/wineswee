-- 排班頁靠 employment_category(salary_structures)把「行政(admin,固定時間)」排除在排班外。
-- 但 salary_structures SELECT policy = can_see_request(employee_id) → 督導/經理只讀得到自己下屬的,
-- 讀不到的人 employment_category=null → 排除規則失效 → 督導看到全店(含 21 個行政)。
-- employment_category 只是工作分類(非薪資、不敏感)→ 開 DEFINER RPC 只回這一欄,繞過薪資 RLS,不洩薪水。
CREATE OR REPLACE FUNCTION public.list_employment_categories()
RETURNS TABLE(employee_id integer, employment_category text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ss.employee_id, ss.employment_category
  FROM public.salary_structures ss
  WHERE public.is_super_admin()
     OR ss.organization_id = public.current_employee_org();
$function$;

REVOKE ALL ON FUNCTION public.list_employment_categories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_employment_categories() TO authenticated;
