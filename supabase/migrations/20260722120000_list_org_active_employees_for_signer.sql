-- 網頁加簽選人改走 SECURITY DEFINER RPC 撈全 org 員工 — 2026-07-22
-- 病灶:ExtraSignerControls 直查 employees(走 RLS),非 admin 簽核人只看得到自己門市 →
--   加簽選人幾乎空。但加簽本意是「邀請公司任何同事(常往上找主管)協助簽核」,不該受簽核人門市範圍限。
--   對齊 LIFF(liff_list_employees_in_org 也是 SECURITY DEFINER 撈全 org)。
-- 回全 org 在職員工;org 靠 current_user_org_id() 解(auth.uid()→員工→org)。

CREATE OR REPLACE FUNCTION public.list_org_active_employees()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(json_build_object(
    'id',            e.id,
    'name',          e.name,
    'dept',          e.dept,
    'store',         e.store,
    'department_id', e.department_id
  ) ORDER BY e.name), '[]'::json)
  FROM public.employees e
  WHERE e.status = '在職'
    AND e.organization_id = public.current_user_org_id()
$$;

GRANT EXECUTE ON FUNCTION public.list_org_active_employees() TO authenticated;

NOTIFY pgrst, 'reload schema';
