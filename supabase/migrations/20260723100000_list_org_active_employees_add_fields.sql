-- list_org_active_employees 補欄位對齊 liff_list_employees — 2026-07-23
-- ────────────────────────────────────────────────────────────────────────────
-- 背景：Web 稽核「當班人員」下拉原本直查 employees(走 RLS),被上週多租戶 org 隔離
--       (employees_select_v4)收緊後降級成「本 org/本店」→ 選人少一半(慘案:只回 23)。
--       LIFF 同功能走 liff_list_employees(SECURITY DEFINER)天生撈全 org,兩邊不對等。
-- 解法：Web 稽核改走本 RPC(靠 auth.uid() 解 org,不需 line_user_id),但原 RPC 只回 5 欄,
--       稽核/加簽標籤要「名字 (英文) 職稱」需 name_en/position,故補齊欄位對齊 LIFF。
-- 影響：純加欄位、維持回傳 bare JSON array。既有唯一消費者 ExtraSignerControls 只挑自己
--       要的 key(且會順便多顯示英文名/職稱),不受影響。
-- 範圍不變：仍是 WHERE status='在職' AND organization_id = current_user_org_id()。

CREATE OR REPLACE FUNCTION public.list_org_active_employees()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(json_build_object(
    'id',            e.id,
    'name',          e.name,
    'name_en',       e.name_en,
    'position',      e.position,
    -- 對齊系統慣例：dept/store 優先用 denormalized text,fallback join name
    'dept',          COALESCE(e.dept, d.name),
    'store',         COALESCE(e.store, s.name),
    'department_id', e.department_id,
    'store_id',      e.store_id
  ) ORDER BY e.name), '[]'::json)
  FROM public.employees e
  LEFT JOIN public.departments d ON d.id = e.department_id
  LEFT JOIN public.stores      s ON s.id = e.store_id
  WHERE e.status = '在職'
    AND e.organization_id = public.current_user_org_id()
$$;

GRANT EXECUTE ON FUNCTION public.list_org_active_employees() TO authenticated;

NOTIFY pgrst, 'reload schema';
