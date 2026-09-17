-- ③ 個人銷售激勵:LIFF 薪資袋加 personal_sales(員工於發放月看到個人銷售獎金)
CREATE OR REPLACE FUNCTION public.liff_get_my_store_bonus(p_line_user_id text, p_limit integer DEFAULT 12)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  RETURN json_build_object(
    'ok', true,
    'records', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.year_month DESC), '[]'::json)
      FROM (
        SELECT
          m.year_month            AS year_month,
          e.net_bonus             AS net_bonus,
          e.total_bonus           AS total_bonus,
          e.mgmt_bonus            AS mgmt_bonus,
          e.profit_bonus          AS profit_bonus,
          e.target_bonus          AS target_bonus,
          e.merit_bonus           AS merit_bonus,
          e.audit_deduction       AS audit_deduction,
          e.punch_deduction       AS punch_deduction,
          e.custom_adjust         AS custom_adjust,
          e.prev_month_supplement AS prev_month_supplement,
          e.notes                 AS notes
        FROM public.store_bonus_employee e
        JOIN public.store_bonus_monthly m ON m.id = e.monthly_id
        WHERE e.employee_id = emp.id AND m.status = 'finalized'
        ORDER BY m.year_month DESC
        LIMIT GREATEST(1, COALESCE(p_limit, 12))
      ) t
    ),
    'quarters', (
      SELECT COALESCE(json_agg(json_build_object(
        'year', s.year, 'quarter', s.quarter, 'months', s.months,
        'payout_year_month', s.payout_year_month,
        'months_count', (r.value->>'months')::int,
        'total_mgmt',   COALESCE((r.value->>'total_mgmt')::numeric,0),
        'total_target', COALESCE((r.value->>'total_target')::numeric,0),
        'total_merit',  COALESCE((r.value->>'total_merit')::numeric,0),
        'total_deduct', COALESCE((r.value->>'total_deduct')::numeric,0),
        'total_net',    COALESCE((r.value->>'total_net')::numeric,0)
      ) ORDER BY s.year DESC, s.quarter DESC), '[]'::json)
      FROM public.store_bonus_quarter_settlement s
      CROSS JOIN LATERAL jsonb_array_elements(s.rows) r
      WHERE s.organization_id = emp.organization_id
        AND (r.value->>'employee_id')::int = emp.id
    ),
    'competitions', (
      SELECT COALESCE(json_agg(json_build_object(
        'year', c.year, 'period', c.period, 'payout_year_month', c.payout_year_month,
        'store_name', (r2.value->>'store_name'),
        'rank',   (r2.value->>'rank')::int,
        'prize',  COALESCE((r2.value->>'prize')::numeric,0),
        'growth', (r2.value->>'growth')::numeric
      ) ORDER BY c.year DESC, c.period DESC), '[]'::json)
      FROM public.store_bonus_competition_result c
      CROSS JOIN LATERAL jsonb_array_elements(c.rows) r2
      WHERE c.organization_id = emp.organization_id
        AND (r2.value->>'manager_id')::int = emp.id
        AND COALESCE((r2.value->>'prize')::numeric,0) > 0
    ),
    'personal_sales', (
      SELECT COALESCE(json_agg(json_build_object(
        'sale_date', ps.sale_date, 'sale_amount', ps.sale_amount,
        'bonus', ps.bonus, 'payout_year_month', ps.payout_year_month, 'notes', ps.notes
      ) ORDER BY ps.sale_date DESC), '[]'::json)
      FROM public.personal_sale_incentive ps
      WHERE ps.employee_id = emp.id AND COALESCE(ps.bonus,0) > 0
    )
  );
END $function$
;

NOTIFY pgrst, 'reload schema';
