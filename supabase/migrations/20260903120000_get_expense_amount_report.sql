-- 2026-09-03 非經常性費用「單筆金額」分析報表 RPC
--   單筆金額 = COALESCE(NULLIF(actual_amount,0), estimated_amount)(實際優先,沒有用預估)
--   排除 已駁回 / 核銷已退回 / 已刪除;可選期間 [p_from, p_to](NULL=全部)
--   一次回:整體(筆數/平均/中位數/總額/最小/最大)+ 各科目 + 各月(皆含平均與中位數)

CREATE OR REPLACE FUNCTION public.get_expense_amount_report(p_org int, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_overall json; v_cat json; v_mon json;
BEGIN
  IF p_org IS NULL OR NOT public._same_org_or_super(p_org) THEN RETURN NULL; END IF;

  WITH base AS (
    SELECT COALESCE(NULLIF(actual_amount, 0), estimated_amount)::numeric AS amt,
           COALESCE(NULLIF(btrim(account_name), ''), '(未分類)')          AS cat,
           to_char(created_at, 'YYYY-MM')                                 AS ym
      FROM public.expense_requests
     WHERE organization_id = p_org AND deleted_at IS NULL
       AND status NOT IN ('已駁回', '核銷已退回')
       AND COALESCE(NULLIF(actual_amount, 0), estimated_amount) IS NOT NULL
       AND (p_from IS NULL OR created_at::date >= p_from)
       AND (p_to   IS NULL OR created_at::date <= p_to)
  )
  SELECT
    (SELECT json_build_object(
       'n', count(*), 'avg', round(avg(amt)),
       'median', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY amt)),
       'total', round(sum(amt)), 'min', round(min(amt)), 'max', round(max(amt))
     ) FROM base),
    (SELECT COALESCE(json_agg(json_build_object('name', cat, 'n', n, 'avg', a, 'median', m, 'total', t) ORDER BY t DESC), '[]'::json)
       FROM (SELECT cat, count(*) n, round(avg(amt)) a,
                    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY amt)) m, round(sum(amt)) t
               FROM base GROUP BY cat) c),
    (SELECT COALESCE(json_agg(json_build_object('ym', ym, 'n', n, 'avg', a, 'median', m, 'total', t) ORDER BY ym), '[]'::json)
       FROM (SELECT ym, count(*) n, round(avg(amt)) a,
                    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY amt)) m, round(sum(amt)) t
               FROM base GROUP BY ym) mo)
  INTO v_overall, v_cat, v_mon;

  RETURN json_build_object(
    'overall', COALESCE(v_overall, json_build_object('n', 0)),
    'by_category', v_cat, 'by_month', v_mon
  );
END $fn$;

REVOKE ALL ON FUNCTION public.get_expense_amount_report(int,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expense_amount_report(int,date,date) TO authenticated;
