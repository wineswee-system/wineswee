-- 「我的可見門市」RPC(跨店主管/督導可見範圍,單一真相)— 2026-08-03
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:3c65d03c 修對主管角色偵測後,打卡追蹤/團隊儀表板等頁的「isManager + 所屬門市」
--   窄過濾啟動 → 督導(黃蘊珊)只看得到所屬門市(總部),看不到她督導的其他店。
-- 修:提供 web_my_visible_store_ids() 回傳「當前登入者可見的門市 id 陣列」,判準用
--   _can_see_store_for_emp(所屬/店長/user_stores/部門督導 section),看全店者回全 org。
--   前端據此過濾,對齊排班頁/RLS 的可見性(單一真相)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.web_my_visible_store_ids()
RETURNS int[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp employees;
  v_ids int[];
BEGIN
  SELECT * INTO v_emp FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_emp.id IS NULL THEN RETURN ARRAY[]::int[]; END IF;

  IF public._emp_sees_all_stores(v_emp.id) THEN
    SELECT array_agg(id) INTO v_ids
      FROM public.stores WHERE organization_id = v_emp.organization_id;
  ELSE
    SELECT array_agg(s.id) INTO v_ids
      FROM public.stores s
     WHERE s.organization_id = v_emp.organization_id
       AND public._can_see_store_for_emp(v_emp.id::bigint, s.id::bigint);
  END IF;

  RETURN COALESCE(v_ids, ARRAY[]::int[]);
END $$;

REVOKE ALL ON FUNCTION public.web_my_visible_store_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.web_my_visible_store_ids() TO authenticated;

NOTIFY pgrst, 'reload schema';
