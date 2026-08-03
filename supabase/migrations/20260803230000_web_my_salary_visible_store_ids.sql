-- 薪資用「我的可見門市」RPC — 可見門市減掉總部(hq)— 2026-08-03
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:督導/店長可以看「轄下門市」的薪資,但「總部(store_type='hq')」薪資屬高層/行政,
--   不給督導看。故薪資可見門市 = _can_see_store_for_emp 可見門市 − store_type='hq'。
--   (打卡追蹤用 web_my_visible_store_ids 含總部;薪資用這支不含總部。)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.web_my_salary_visible_store_ids()
RETURNS int[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp employees;
  v_ids int[];
BEGIN
  SELECT * INTO v_emp FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  IF v_emp.id IS NULL THEN RETURN ARRAY[]::int[]; END IF;

  SELECT array_agg(s.id) INTO v_ids
    FROM public.stores s
   WHERE s.organization_id = v_emp.organization_id
     AND COALESCE(s.store_type, '') <> 'hq'   -- 薪資不看總部(高層/行政)
     AND (public._emp_sees_all_stores(v_emp.id)
          OR public._can_see_store_for_emp(v_emp.id::bigint, s.id::bigint));

  RETURN COALESCE(v_ids, ARRAY[]::int[]);
END $$;

REVOKE ALL ON FUNCTION public.web_my_salary_visible_store_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.web_my_salary_visible_store_ids() TO authenticated;

NOTIFY pgrst, 'reload schema';
