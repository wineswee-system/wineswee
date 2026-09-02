-- 對齊店長:LIFF 門市稽核入口(can_view_store_audit)原本只給 店長(store.manager_id)/督導/營運/稽核室/admin,
-- 沒算「儲備幹部」→ 儲備在 LIFF 看不到稽核入口(雖然資料層 _can_see_store_for_emp 已允許他看自店已核准稽核單)。
-- 加一條:儲備幹部也顯示入口。清單本身仍靠 _can_see_store_for_emp 鎖在自己店,不會越權看別店。

CREATE OR REPLACE FUNCTION public.liff_get_employee_by_line_user(p_line_user_id text)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (
    row_to_json(e.*)::jsonb
    || jsonb_build_object(
         'can_store_audit',
         public.liff_employee_has_permission(e.id, 'liff.store_audit'),
         'can_view_store_audit',
         (public.liff_employee_has_permission(e.id, 'liff.store_audit')
          OR public.liff_employee_has_permission(e.id, 'liff.store_audit.view_all')
          OR public.liff_employee_has_permission(e.id, 'store_audit.view_draft')
          OR EXISTS (SELECT 1 FROM roles r WHERE r.id = e.role_id AND r.name IN ('admin','super_admin'))
          OR EXISTS (SELECT 1 FROM stores s WHERE s.manager_id = e.id)
          OR EXISTS (SELECT 1 FROM department_sections ds WHERE ds.supervisor_id = e.id)
          OR (e.position LIKE '%儲備%' AND e.store_id IS NOT NULL))   -- ★ 儲備幹部(有掛門市)對齊店長
       )
  )::json
  FROM employees e
  JOIN employee_line_accounts ela ON ela.employee_id = e.id
  WHERE ela.line_user_id = p_line_user_id
    AND e.status = '在職'
  ORDER BY ela.is_primary DESC, ela.id ASC
  LIMIT 1
$function$;
