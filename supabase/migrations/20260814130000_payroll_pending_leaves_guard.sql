-- 計薪前防護:列出該月「還卡在簽核中(待審核/審核中/申請中)」的假單。
-- HR 應先全部過/駁回再結薪 → 結薪時餘額才是定的(不會有折現/請假打架)。
CREATE OR REPLACE FUNCTION public.payroll_pending_leaves(p_org integer, p_year_month text)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH d AS (
    SELECT make_date(split_part(p_year_month,'-',1)::int, split_part(p_year_month,'-',2)::int, 1) AS mstart
  )
  SELECT json_build_object(
    'year_month', p_year_month,
    'pending_count', COUNT(*),
    'items', COALESCE(json_agg(json_build_object(
      'id', lr.id, 'employee', lr.employee, 'type', lr.type,
      'start_date', lr.start_date, 'days', lr.days, 'hours', lr.hours, 'status', lr.status
    ) ORDER BY lr.employee, lr.start_date), '[]'::json)
  )
  FROM leave_requests lr, d
  WHERE lr.organization_id = p_org AND lr.deleted_at IS NULL
    AND lr.status IN ('待審核','審核中','申請中')
    AND lr.start_date < (d.mstart + interval '1 month')   -- 起日在該月底前(該算進這期的都要先決）
$function$;
