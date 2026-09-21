-- 門市權責總表(唯讀):一頁看每間店的負責人/區督導/額外可存取者/全店權限者 + 缺口。
-- admin/super_admin 限定。DEFINER 繞 RLS 一次算好整份矩陣(對齊排班/稽核的店範圍規則:
--   本店 / 店負責人(stores.manager_id) / 區督導(department_sections.supervisor_id) / user_stores 額外指派)。
CREATE OR REPLACE FUNCTION public.get_store_responsibility_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller employees;
  v_org int;
  v_all jsonb;
  v_stores jsonb;
BEGIN
  SELECT * INTO v_caller FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_caller.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CALLER_NOT_FOUND'); END IF;
  IF v_caller.role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ALLOWED');
  END IF;
  v_org := v_caller.organization_id;

  -- 全店權限者(每間店都能看+能排):admin/super_admin 角色、schedule.view_all、營運部(oversees_all_stores)主管
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb) INTO v_all FROM (
    SELECT jsonb_build_object('id', e.id, 'name', e.name, 'role', r.name,
      'reason', CASE
        WHEN r.name IN ('admin', 'super_admin') THEN '角色'
        WHEN EXISTS (SELECT 1 FROM departments d WHERE d.manager_id = e.id AND d.oversees_all_stores) THEN '營運部主管'
        ELSE 'schedule.view_all' END) x
    FROM employees e JOIN roles r ON r.id = e.role_id
    WHERE e.status = '在職' AND e.organization_id = v_org
      AND (r.name IN ('admin', 'super_admin')
           OR public.liff_employee_has_permission(e.id, 'schedule.view_all')
           OR EXISTS (SELECT 1 FROM departments d WHERE d.manager_id = e.id AND d.oversees_all_stores))
  ) t;

  -- 每間店的權責
  SELECT COALESCE(jsonb_agg(rowj ORDER BY (rowj->>'is_active')::boolean DESC, rowj->>'store_name'), '[]'::jsonb)
  INTO v_stores FROM (
    SELECT jsonb_build_object(
      'store_id', s.id,
      'store_name', s.name,
      'is_active', COALESCE(s.is_active, true),
      'section_name', ds.name,
      'manager', CASE WHEN mgr.id IS NOT NULL THEN jsonb_build_object(
                   'id', mgr.id, 'name', mgr.name,
                   'can_schedule', public.liff_employee_has_permission(mgr.id, 'schedule.edit')) END,
      'supervisor', CASE WHEN sup.id IS NOT NULL THEN jsonb_build_object('id', sup.id, 'name', sup.name) END,
      'extra', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', ue.id, 'name', ue.name,
                 'can_schedule', public.liff_employee_has_permission(ue.id, 'schedule.edit')) ORDER BY ue.name)
        FROM user_stores us JOIN employees ue ON ue.id = us.employee_id
        WHERE us.store_id = s.id AND ue.status = '在職'
          AND ue.id IS DISTINCT FROM s.manager_id
          AND ue.id IS DISTINCT FROM ds.supervisor_id), '[]'::jsonb),
      'gaps', (SELECT COALESCE(jsonb_agg(g), '[]'::jsonb) FROM (
        SELECT '缺店負責人' g WHERE COALESCE(s.is_active, true) AND s.manager_id IS NULL
        UNION ALL
        SELECT '負責人無排班權' WHERE COALESCE(s.is_active, true) AND mgr.id IS NOT NULL
          AND NOT public.liff_employee_has_permission(mgr.id, 'schedule.edit')
      ) gg)
    ) rowj
    FROM stores s
    LEFT JOIN employees mgr ON mgr.id = s.manager_id
    LEFT JOIN department_sections ds ON ds.id = s.section_id
    LEFT JOIN employees sup ON sup.id = ds.supervisor_id
    WHERE s.organization_id = v_org
  ) t;

  RETURN jsonb_build_object('ok', true, 'all_store_people', v_all, 'stores', v_stores);
END $function$;

REVOKE ALL ON FUNCTION public.get_store_responsibility_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_responsibility_overview() TO authenticated;

-- 逐入口權限碼 + 發給 admin/super_admin(不建的話 nav-entry 守門會把 admin 也擋掉)
INSERT INTO public.permissions (code, name, module, is_system, is_active)
VALUES ('nav.entry.org.store-responsibility', '組織 · 門市權責', '導航 · 組織架構', true, true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
WHERE r.name IN ('admin','super_admin') AND p.code = 'nav.entry.org.store-responsibility'
ON CONFLICT DO NOTHING;
