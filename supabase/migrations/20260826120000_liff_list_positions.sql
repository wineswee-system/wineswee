-- LIFF 人事異動「新職稱」下拉:讓 anon 拿到本 org 的啟用職位清單。
-- 照 liff_list_stores 解 org(_liff_resolve_employee)+ list_positions 過濾(is_active,依 sort_order)。
-- 福董在後台「職位管理」增改 positions 表 → LIFF 下拉自動同步。
CREATE OR REPLACE FUNCTION public.liff_list_positions(p_line_user_id text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(json_build_object('category', p.category, 'label', p.label) ORDER BY p.sort_order, p.id), '[]'::json)
  FROM public.positions p
  WHERE p.organization_id = (SELECT organization_id FROM public._liff_resolve_employee(p_line_user_id))
    AND p.is_active;
$function$;

REVOKE ALL ON FUNCTION public.liff_list_positions(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.liff_list_positions(text) TO anon, authenticated;
