-- 打卡核對報表:排除編制外員工 + 差異筆數排除「多上時數」 — 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 承 20260730140000,再加:編制外員工(in_payroll=FALSE,老闆/外包/合約商,不計薪)
--   不列入打卡核對報表(他們本來就不照排班打卡)。加 WHERE e.in_payroll。
-- (既有)差異筆數(diff_count)只算「需處理」的差異 = 遲到/時數不足/未打卡/早退/未排班打卡;
--   只有「多上時數 OVERWORK」(正向)不算。type_counts 仍回全部類型;明細(monthly_attendance_diff)不動。
-- 整支 CREATE OR REPLACE 為最終版,idempotent。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_attendance_diff_report(p_year_month text, p_store_id integer DEFAULT NULL::integer)
 RETURNS TABLE(employee_id integer, employee_name text, store_name text, diff_count bigint, type_counts jsonb, notified boolean, is_resigned boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store_name TEXT;
  v_mstart DATE := to_date(p_year_month || '-01', 'YYYY-MM-DD');
BEGIN
  IF p_store_id IS NOT NULL THEN
    SELECT name INTO v_store_name FROM public.stores WHERE id = p_store_id;
  END IF;
  RETURN QUERY
  SELECT e.id, e.name, s.name,
    COALESCE(d.total,0)::bigint,
    COALESCE(d.by_type, '{}'::jsonb),
    EXISTS(SELECT 1 FROM public.attendance_diff_notifications n WHERE n.employee_id=e.id AND n.year_month=p_year_month),
    (e.status = '離職')
  FROM public.employees e
  LEFT JOIN public.stores s ON s.id = e.store_id
  LEFT JOIN LATERAL (
    -- total 排除 OVERWORK 多上時數(正向、非待處理);其餘(含 UNSCHEDULED 未排班打卡)都算;by_type 仍回全部類型
    SELECT COALESCE(SUM(cnt) FILTER (WHERE dt <> 'OVERWORK'), 0) AS total,
           jsonb_object_agg(dt, cnt) AS by_type
    FROM (SELECT diff_type AS dt, COUNT(*) AS cnt
          FROM public.monthly_attendance_diff(e.id, p_year_month)
          WHERE diff_type IS NOT NULL GROUP BY diff_type) g
  ) d ON true
  WHERE (e.status = '在職' OR (e.status = '離職' AND e.resign_date >= v_mstart))
    AND e.in_payroll                                    -- 編制外(in_payroll=FALSE,老闆/外包)不列入核對
    AND e.organization_id = current_employee_org()
    AND (p_store_id IS NULL OR e.store_id = p_store_id
         OR (v_store_name IS NOT NULL AND v_store_name = ANY(e.additional_stores)))
  ORDER BY COALESCE(d.total,0) DESC, e.name;
END $function$;

NOTIFY pgrst, 'reload schema';
