-- 2026-08-14 唯讀預覽:到期未休特休/2025結算(折特休工資)+舊補休結算(時薪×1.34)每月折現名單。
-- 排除離職(離職走引擎當月折現)+編制外(in_payroll=false)。尚未接入真入帳,純算金額給人核。
CREATE OR REPLACE FUNCTION public._preview_expired_leave_cashout(p_org integer, p_month_end date)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH rws AS (
    SELECT e.id AS emp_id, e.name, e.salary_type, lb.leave_type, lb.expires_at,
      (lb.total_days+COALESCE(lb.carry_over_days,0)-lb.used_days) AS unused_days,
      CASE WHEN COALESCE(e.salary_type,'')='hourly' THEN COALESCE(e.base_salary,0)/30.0
           ELSE public._employee_avg_monthly_wage(e.id)/30.0 END AS daily_wage,
      public._employee_avg_monthly_wage(e.id)/240.0 AS hourly_wage
    FROM leave_balances lb JOIN employees e ON e.id=lb.employee_id
    WHERE lb.organization_id=p_org AND lb.expires_at < p_month_end
      AND e.status='在職' AND COALESCE(e.in_payroll,true)=true
      AND (lb.total_days+COALESCE(lb.carry_over_days,0)-lb.used_days) > 0
      AND lb.leave_type IN ('annual','特休假2025結算','舊人資系統補休結算')
  ),
  calc AS (
    SELECT emp_id, name, leave_type, expires_at, unused_days,
      CASE WHEN leave_type='舊人資系統補休結算' THEN ceil(unused_days*8 * hourly_wage * 1.34)
           ELSE ceil(unused_days * daily_wage) END AS amount,
      CASE WHEN leave_type='舊人資系統補休結算' THEN '補休到期折現' ELSE '特休到期折現' END AS kind
    FROM rws
  )
  SELECT json_build_object(
    'month_end', p_month_end,
    'total_amount', COALESCE(SUM(amount),0),
    'count', COUNT(*),
    'by_kind', (SELECT json_object_agg(kind, s) FROM (SELECT kind, SUM(amount) s FROM calc GROUP BY kind) k),
    'items', COALESCE(json_agg(json_build_object('name',name,'type',leave_type,'expires',expires_at,'unused',unused_days,'amount',amount) ORDER BY amount DESC),'[]'::json)
  ) FROM calc;
$function$;
