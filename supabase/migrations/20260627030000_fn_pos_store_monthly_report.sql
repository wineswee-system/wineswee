-- Monthly per-store POS report (WaiterMode data: pos_orders / pos_order_items / pos_payments)
-- fn_pos_analytics queries pos_transactions (old simple-POS); this RPC queries the new tables.

CREATE OR REPLACE FUNCTION public.fn_pos_store_monthly_report(
  p_org_id    BIGINT,
  p_year_month DATE DEFAULT NULL   -- any date in target month; NULL = current month
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_month     DATE := date_trunc('month', COALESCE(p_year_month, CURRENT_DATE));
  v_month_end DATE := v_month + INTERVAL '1 month';
  v_stores    jsonb;
  v_top_items jsonb;
  v_total_rev NUMERIC;
  v_total_ord BIGINT;
BEGIN
  -- Per-store summary (join pos_payments so revenue = actually collected amount)
  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'revenue' DESC), '[]')
  INTO v_stores
  FROM (
    SELECT jsonb_build_object(
      'store_id',    o.store_id,
      'store_name',  s.name,
      'revenue',     COALESCE(SUM(p.amount), 0),
      'order_count', COUNT(DISTINCT o.id),
      'avg_ticket',  ROUND(COALESCE(AVG(p.amount), 0), 0)
    ) AS row
    FROM pos_orders o
    JOIN pos_payments p ON p.order_id = o.id
    JOIN stores s       ON s.id = o.store_id
    WHERE o.organization_id = p_org_id
      AND o.status = 'paid'
      AND o.paid_at >= v_month
      AND o.paid_at <  v_month_end
    GROUP BY o.store_id, s.name
  ) sub;

  -- Top 20 items sold across all stores this month
  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'revenue' DESC), '[]')
  INTO v_top_items
  FROM (
    SELECT jsonb_build_object(
      'name',    oi.name,
      'qty',     SUM(oi.quantity),
      'revenue', ROUND(SUM(oi.unit_price * oi.quantity), 0)
    ) AS row
    FROM pos_order_items oi
    JOIN pos_orders o ON o.id = oi.order_id
    WHERE o.organization_id = p_org_id
      AND o.status = 'paid'
      AND o.paid_at >= v_month
      AND o.paid_at <  v_month_end
    GROUP BY oi.name
    ORDER BY SUM(oi.unit_price * oi.quantity) DESC
    LIMIT 20
  ) sub;

  -- Org-level totals
  SELECT
    COALESCE(SUM(p.amount), 0),
    COUNT(DISTINCT o.id)
  INTO v_total_rev, v_total_ord
  FROM pos_orders o
  JOIN pos_payments p ON p.order_id = o.id
  WHERE o.organization_id = p_org_id
    AND o.status = 'paid'
    AND o.paid_at >= v_month
    AND o.paid_at <  v_month_end;

  RETURN jsonb_build_object(
    'year_month',   to_char(v_month, 'YYYY-MM'),
    'total_revenue', v_total_rev,
    'total_orders',  v_total_ord,
    'stores',        v_stores,
    'top_items',     v_top_items
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_pos_store_monthly_report(BIGINT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_pos_store_monthly_report(BIGINT, DATE) TO authenticated;
