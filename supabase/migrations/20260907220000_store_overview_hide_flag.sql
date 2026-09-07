-- 門市權責:支援把特定人從「全店權限者」名單隱藏(僅此頁顯示效果,不影響實際權限)。
-- 機制:員工被授予 store_responsibility.hidden 個人權限 → 不列於名單。授予對象由 DB 資料決定,不寫死於此。
INSERT INTO public.permissions (code,name,module,is_system,is_active) VALUES ('store_responsibility.hidden','門市權責·名單隱藏','導航 · 組織架構',true,true) ON CONFLICT (code) DO NOTHING;

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
      AND NOT EXISTS (SELECT 1 FROM employee_permissions ep JOIN permissions pp ON pp.id=ep.permission_id
                       WHERE ep.employee_id=e.id AND pp.code='store_responsibility.hidden' AND ep.mode='grant')  -- 排除被標記隱藏者
  ) t;

  SELECT COALESCE(jsonb_agg(rowj ORDER BY (rowj->>'is_active')::boolean DESC, rowj->>'store_name'), '[]'::jsonb)
  INTO v_stores FROM (
    WITH edit_emps AS (   -- 先算一次「有 schedule.edit 的在職員工」,避免逐店逐員重算(效能)
      SELECT e.id, e.name FROM employees e
      WHERE e.organization_id = v_org AND e.status = '在職'
        AND public.liff_employee_has_permission(e.id, 'schedule.edit')
    )
    SELECT jsonb_build_object(
      'store_id', s.id,
      'store_name', s.name,
      'is_active', COALESCE(s.is_active, true),
      'section_name', ds.name,
      'manager', CASE WHEN mgr.id IS NOT NULL THEN jsonb_build_object(
                   'id', mgr.id, 'name', mgr.name,
                   'can_schedule', public.liff_employee_has_permission(mgr.id, 'schedule.edit')) END,
      'supervisor', CASE WHEN sup.id IS NOT NULL THEN jsonb_build_object('id', sup.id, 'name', sup.name,
                   'can_schedule', public.liff_employee_has_permission(sup.id, 'schedule.edit')) END,
      -- 額外可存取:只留真正「跨店」的人(排除本店員工的冗餘列 + 負責人/督導)
      'extra', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', ue.id, 'name', ue.name, 'home_store', hs.name,
                 'can_schedule', public.liff_employee_has_permission(ue.id, 'schedule.edit')) ORDER BY ue.name)
        FROM user_stores us
        JOIN employees ue ON ue.id = us.employee_id
        LEFT JOIN stores hs ON hs.id = ue.store_id
        WHERE us.store_id = s.id AND ue.status = '在職'
          AND ue.store_id IS DISTINCT FROM s.id                 -- ★ 排除本店員工(冗餘)
          AND ue.id IS DISTINCT FROM s.manager_id
          AND ue.id IS DISTINCT FROM ds.supervisor_id), '[]'::jsonb),
      -- 可排班:有 schedule.edit 且對該店有範圍(本店/負責人/督導/user_stores);不含全店權限者(另列頁面上方)
      'schedulers', COALESCE((
        SELECT jsonb_agg(ee.name ORDER BY ee.name)
        FROM edit_emps ee
        WHERE public._can_see_store_for_emp(ee.id::bigint, s.id::bigint)
      ), '[]'::jsonb),
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
END $function$

