-- 批次計薪門市篩選:只認本店(e.store),不吃 additional_stores — 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:preview_payroll 門市篩選有一條 `p_store_filter = ANY(e.additional_stores)`。
--   但 additional_stores(可跨店支援的門市)幾乎每個人都被灌了全部 15 間店
--   → 選任何一間店都 match 全部 83 人 → 門市篩選形同無效。
-- 修:薪資按「本店」算,篩選只認 e.store = p_store_filter(拿掉 additional_stores 那條)。
--   顯示端(Salary.jsx)本來就按本店濾,改後兩邊一致。generate_payroll(入帳)無門市參數
--   =一律全部人,不受影響。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.preview_payroll(p_period text, p_org integer, p_store_filter text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_year   INT  := split_part(p_period,'-',1)::int;
  v_month  INT  := split_part(p_period,'-',2)::int;
  v_mstart date := make_date(v_year, v_month, 1);
  v_mend   date := (make_date(v_year, v_month, 1) + interval '1 month - 1 day')::date;
  v_result json;
BEGIN
  SELECT COALESCE(json_agg(public._compute_payroll_for_employee(e.id, p_period) ORDER BY e.name), '[]'::json)
    INTO v_result
  FROM employees e
  WHERE e.organization_id = p_org
    AND (e.in_payroll IS NOT FALSE)   -- 編制外員工不納入薪資計算
    -- 到職<=月底 且 (在職 或 當月離職)，以計薪月份為準、非相對今天
    AND (e.join_date IS NULL OR e.join_date <= v_mend)
    AND (
      e.status = '在職'
      OR (e.status = '離職'
          AND e.resign_date IS NOT NULL
          AND e.resign_date >= v_mstart
          AND e.resign_date <= v_mend)
    )
    -- 門市篩選:只認本店(additional_stores 幾乎人人含全部店,不能拿來濾薪資)
    AND (p_store_filter IS NULL OR e.store = p_store_filter);
  RETURN v_result;
END $function$;

NOTIFY pgrst, 'reload schema';
