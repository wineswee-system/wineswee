-- 修:督導(manager 角色)排班選課外門市撈不到員工 — 2026-07-20
-- 根因:employees_select_v3 的 manager 分支只給「自己門市」(store_id=current_user_store_id())。
--   但督導(如黃蘊珊 role=manager)靠 department_sections 督導整課(營運二課7店),排班 scope 選得到
--   那些店,員工 RLS 卻只放行自己門市 → 選到課內其他店(中山國小 store29)員工全被 RLS 擋 → 空。
-- 修:新增一支 SECURITY DEFINER helper 回「我能管的門市 id」= 自己店 + 我當店長的店(stores.manager_id)
--   + 我督導的課的店(department_sections.supervisor_id) + 我當經理的部門的所有店(departments.manager_id
--   → 該部門所有課 → 所有店;如張庭瑋=營運部經理看得到全營運部12店)。再加一條「加分」permissive
--   SELECT policy 讓這些店的員工也讀得到。純新增,不動既有 employees_select_v3(避免動關鍵 policy)。
-- ★ SECURITY DEFINER 繞 RLS 查 employees/stores/department_sections,避免 policy 自查 employees 遞迴。

-- ── helper:我(manager/督導)能看到員工的門市 id 集合 ──
CREATE OR REPLACE FUNCTION public.current_user_manager_store_ids()
RETURNS int[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (
    SELECT e.id, e.store_id
    FROM public.employees e
    WHERE e.auth_user_id = auth.uid()
    ORDER BY (e.auth_user_id = auth.uid()) DESC
    LIMIT 1
  )
  SELECT COALESCE(array_agg(DISTINCT sid), '{}')::int[]
  FROM (
    -- 自己門市
    SELECT store_id AS sid FROM me WHERE store_id IS NOT NULL
    UNION
    -- 我當店長的店
    SELECT s.id FROM public.stores s JOIN me ON s.manager_id = me.id
    UNION
    -- 我督導的課(department_sections.supervisor_id=我)涵蓋的店
    SELECT s.id
    FROM public.stores s
    JOIN public.department_sections ds ON ds.id = s.section_id
    JOIN me ON ds.supervisor_id = me.id
    UNION
    -- 我當經理的部門(departments.manager_id=我)底下所有課的所有店(部門經理看整部門)
    SELECT s.id
    FROM public.stores s
    JOIN public.department_sections ds ON ds.id = s.section_id
    JOIN public.departments d ON d.id = ds.department_id
    JOIN me ON d.manager_id = me.id
  ) x;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_manager_store_ids() TO authenticated;

-- ── 加分 policy:讓管理者看得到「他能管的門市」的員工(加在 v3 之上,permissive OR)──
DROP POLICY IF EXISTS employees_select_manager_scope ON public.employees;
CREATE POLICY employees_select_manager_scope ON public.employees
FOR SELECT TO authenticated
USING (
  -- 包 (SELECT ...) 讓 helper 每次查詢只算一次(對齊 employees_select_v4 的寫法,避免 per-row 呼叫)
  store_id = ANY ((SELECT public.current_user_manager_store_ids()))
);

COMMENT ON POLICY employees_select_manager_scope ON public.employees IS
  '2026-07-20 補:店長/督導看得到「自己店+當店長的店+督導的課的店」員工(對齊排班scope)。加在 v3 之上 OR。';

NOTIFY pgrst, 'reload schema';
