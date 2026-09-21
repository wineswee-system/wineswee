-- 手動加補休(單人/批次共用)+ 過期可折現 — 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- schema 已支援:comp_time_ledger.overtime_request_id 可 null、有 source 欄。
-- 規則:overtime_request_id=NULL、source='手動加給'、ot_date=今天、
--   expires_at=今天+1年−1天(從加的那天起算一年)、僅 admin。
-- 折現:過期結算 = 剩餘比例 × frozen_ot_amount(_settle_expired_comp_time,直接付凍結金額)。
--   時薪 = salary_structures.base_salary / 30 / 8(對齊系統)。
--   ★ frozen_ot_amount = 時數 × 原時薪(直接工時,不含加班倍率)——手動給假非實際加班。
--     (若要比照加班費率折現,把 v_amt 改成 _compute_ot_pay(...) 即可。)
-- 傳 p_emp_ids 陣列 → 單人=一個 id、批次=多個 id。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.add_manual_comp_time(p_emp_ids integer[], p_hours numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cnt   integer := 0;
  v_eid   integer;
  v_org   integer;
  v_base  numeric;
  v_rate  numeric;
  v_amt   numeric;
  v_today date := CURRENT_DATE;
BEGIN
  IF current_employee_role() NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION '只有管理員可手動加補休';
  END IF;
  IF p_hours IS NULL OR p_hours <= 0 THEN
    RAISE EXCEPTION '時數必須大於 0';
  END IF;

  FOREACH v_eid IN ARRAY p_emp_ids LOOP
    SELECT COALESCE(ss.base_salary, 0), e.organization_id
      INTO v_base, v_org
      FROM public.employees e
      LEFT JOIN public.salary_structures ss ON ss.employee_id = e.id
     WHERE e.id = v_eid;
    IF v_org IS NULL THEN CONTINUE; END IF;

    v_rate := CASE WHEN v_base > 0 THEN ROUND(v_base / 30.0 / 8.0, 2) ELSE 0 END;
    v_amt  := ROUND(p_hours * v_rate, 2);   -- 折現金額 = 時數 × 原時薪

    INSERT INTO public.comp_time_ledger (
      employee_id, overtime_request_id, organization_id,
      hours, ot_date, expires_at,
      frozen_hourly_rate, frozen_ot_amount,
      status, source
    ) VALUES (
      v_eid, NULL, v_org,
      p_hours, v_today, v_today + INTERVAL '1 year' - INTERVAL '1 day',
      v_rate, v_amt,
      'active', '手動加給'
    );
    v_cnt := v_cnt + 1;
  END LOOP;

  RETURN v_cnt;
END $function$;

GRANT EXECUTE ON FUNCTION public.add_manual_comp_time(integer[], numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
