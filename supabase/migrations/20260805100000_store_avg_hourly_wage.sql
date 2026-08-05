-- 各門市可設定「均薪(時薪)」給排班人事成本比試算 — 2026-08-05
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:排班底部「人事成本比」= 總工時 × 時薪 ÷ 預估業績,時薪原本前端寫死 350。
--   老闆要能在 UI 調(各店均薪不同)。存 stores.avg_hourly_wage(per store,預設350)。
-- 寫入走 DEFINER RPC:排班編輯者常是店長(非 admin),直接 UPDATE stores 可能被 RLS 擋,
--   故用 SECURITY DEFINER + 權限/同org 守門。純顯示層試算,不影響計薪。idempotent。
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS avg_hourly_wage numeric DEFAULT 350;

CREATE OR REPLACE FUNCTION public.set_store_avg_hourly_wage(p_store_id integer, p_wage numeric)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_org int;
  v_store_org  int;
BEGIN
  IF p_wage IS NULL OR p_wage <= 0 THEN RAISE EXCEPTION 'invalid_wage'; END IF;
  -- 權限:admin/super_admin 或有 schedule.edit(店長/督導/營運部)
  IF NOT (public.is_admin() OR public.current_employee_has_permission('schedule.edit')) THEN
    RAISE EXCEPTION 'no_permission';
  END IF;
  -- 同租戶守門(admin/super_admin 例外,可跨店)
  SELECT organization_id INTO v_store_org  FROM public.stores    WHERE id = p_store_id;
  SELECT organization_id INTO v_caller_org FROM public.employees WHERE id = public.current_employee_id();
  IF NOT public.is_admin() AND v_store_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'cross_org';
  END IF;
  UPDATE public.stores SET avg_hourly_wage = p_wage WHERE id = p_store_id;
END $function$;

-- DEFINER 預設 EXECUTE 給 PUBLIC → 收回,只給登入者(擋 anon)
REVOKE ALL ON FUNCTION public.set_store_avg_hourly_wage(integer, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_store_avg_hourly_wage(integer, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
