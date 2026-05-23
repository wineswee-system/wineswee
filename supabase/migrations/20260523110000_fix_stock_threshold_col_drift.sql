-- ════════════════════════════════════════════════════════════════════════════
-- 修正：stock_levels.min_qty 在 live DB 不存在
-- ----------------------------------------------------------------------------
-- 多支 RPC（fn_dashboard_overview / fn_compute_alerts / fn_inventory_analytics）
-- 都假設 stock_levels 有 min_qty 欄位，但 live DB 可能是 safety_stock 或都沒
-- → 動態偵測欄位名，避免 schema drift 炸頁面
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── helper: stock_levels 的「安全庫存閾值」欄位名 ────────────────────────
-- 順序：min_qty (舊 schema) → safety_stock (新 schema) → NULL（都沒）
CREATE OR REPLACE FUNCTION public._stock_threshold_col()
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_col TEXT;
BEGIN
  SELECT column_name INTO v_col
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'stock_levels'
     AND column_name = ANY(ARRAY['min_qty', 'safety_stock', 'reorder_point'])
   ORDER BY CASE column_name
     WHEN 'min_qty' THEN 1
     WHEN 'safety_stock' THEN 2
     WHEN 'reorder_point' THEN 3
   END
   LIMIT 1;
  RETURN v_col;
END $$;

-- ─── helper: 低庫存 SKU 數（>0 但 <= 閾值）──────────────────────────────
CREATE OR REPLACE FUNCTION public._stock_low_count()
RETURNS INT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_col TEXT;
  v_count INT := 0;
BEGIN
  v_col := public._stock_threshold_col();
  IF v_col IS NULL THEN RETURN 0; END IF;
  EXECUTE format('
    SELECT COUNT(*) FROM stock_levels
     WHERE COALESCE(quantity, 0) > 0
       AND COALESCE(quantity, 0) <= COALESCE(%I, 0)
       AND COALESCE(%I, 0) > 0
  ', v_col, v_col) INTO v_count;
  RETURN v_count;
END $$;

-- ─── helper: 缺貨 SKU 數（quantity = 0 且有設閾值）──────────────────────
CREATE OR REPLACE FUNCTION public._stock_out_count()
RETURNS INT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_col TEXT;
  v_count INT := 0;
BEGIN
  v_col := public._stock_threshold_col();
  IF v_col IS NULL THEN RETURN 0; END IF;
  EXECUTE format('
    SELECT COUNT(*) FROM stock_levels
     WHERE COALESCE(quantity, 0) <= 0
       AND COALESCE(%I, 0) > 0
  ', v_col) INTO v_count;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public._stock_threshold_col() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public._stock_low_count() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public._stock_out_count() TO authenticated, anon;


-- ═════════════════════════════════════════════════════════════════════════
-- 重寫 fn_dashboard_overview：低庫存改用 _stock_low_count()
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_dashboard_overview(
  p_org_id INT,
  p_today  DATE DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_yesterday        DATE := p_today - 1;
  v_last_week_same   DATE := p_today - 7;
  v_month_start      DATE := date_trunc('month', p_today)::DATE;
  v_last_month_start DATE := date_trunc('month', p_today - INTERVAL '1 month')::DATE;

  v_today_revenue        NUMERIC := 0;
  v_today_orders         INT     := 0;
  v_yesterday_revenue    NUMERIC := 0;
  v_yesterday_orders     INT     := 0;
  v_last_week_revenue    NUMERIC := 0;
  v_last_week_orders     INT     := 0;

  v_ar_balance           NUMERIC := 0;
  v_ap_balance           NUMERIC := 0;
  v_ar_overdue_count     INT     := 0;
  v_ar_overdue_amount    NUMERIC := 0;
  v_month_revenue        NUMERIC := 0;
  v_month_cost           NUMERIC := 0;
  v_last_month_revenue   NUMERIC := 0;
  v_last_month_cost      NUMERIC := 0;

  v_active_emp           INT     := 0;
  v_term_this_month      INT     := 0;
  v_active_emp_month_start INT   := 0;
  v_today_attend         INT     := 0;
  v_should_attend        INT     := 0;
  v_month_ot_hours       NUMERIC := 0;

  v_low_stock_count      INT     := 0;
  v_stuck_tasks_count    INT     := 0;
  v_expiring_contracts   INT     := 0;
  v_doc_expiring_30d     INT     := 0;
BEGIN
  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_today_revenue, v_today_orders
    FROM pos_transactions
   WHERE created_at::DATE = p_today AND COALESCE(status, '完成') = '完成';

  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_yesterday_revenue, v_yesterday_orders
    FROM pos_transactions
   WHERE created_at::DATE = v_yesterday AND COALESCE(status, '完成') = '完成';

  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_last_week_revenue, v_last_week_orders
    FROM pos_transactions
   WHERE created_at::DATE = v_last_week_same AND COALESCE(status, '完成') = '完成';

  SELECT COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0)
    INTO v_ar_balance
    FROM accounts_receivable WHERE status <> '已收款';

  SELECT COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0)
    INTO v_ap_balance
    FROM accounts_payable WHERE status <> '已付款';

  SELECT COUNT(*), COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0)
    INTO v_ar_overdue_count, v_ar_overdue_amount
    FROM accounts_receivable
   WHERE status <> '已收款'
     AND due_date IS NOT NULL
     AND due_date < p_today
     AND (amount - COALESCE(paid_amount, 0)) > 0;

  SELECT COALESCE(SUM(paid_amount), 0) INTO v_month_revenue
    FROM accounts_receivable WHERE created_at >= v_month_start;
  IF v_month_revenue = 0 THEN
    SELECT COALESCE(SUM(total), 0) INTO v_month_revenue
      FROM pos_transactions
     WHERE created_at >= v_month_start AND COALESCE(status, '完成') = '完成';
  END IF;

  SELECT COALESCE(SUM(paid_amount), 0) INTO v_last_month_revenue
    FROM accounts_receivable
   WHERE created_at >= v_last_month_start AND created_at < v_month_start;
  IF v_last_month_revenue = 0 THEN
    SELECT COALESCE(SUM(total), 0) INTO v_last_month_revenue
      FROM pos_transactions
     WHERE created_at >= v_last_month_start AND created_at < v_month_start
       AND COALESCE(status, '完成') = '完成';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_month_cost FROM accounts_payable
   WHERE created_at >= v_month_start;
  SELECT COALESCE(SUM(amount), 0) INTO v_last_month_cost FROM accounts_payable
   WHERE created_at >= v_last_month_start AND created_at < v_month_start;

  SELECT COUNT(*) INTO v_active_emp
    FROM employees WHERE organization_id = p_org_id AND status = '在職';

  SELECT COUNT(*) INTO v_term_this_month
    FROM v_employee_termination
   WHERE organization_id = p_org_id AND termination_date >= v_month_start;

  v_active_emp_month_start := v_active_emp + v_term_this_month;

  SELECT COUNT(DISTINCT COALESCE(ar.employee_id,
           (SELECT id FROM employees WHERE name = ar.employee
              AND organization_id = p_org_id LIMIT 1)))
    INTO v_today_attend
    FROM attendance_records ar
   WHERE ar.date = p_today AND ar.clock_in IS NOT NULL;

  v_should_attend := v_active_emp;

  SELECT COALESCE(SUM(
    CASE
      WHEN o.hours IS NOT NULL THEN o.hours
      WHEN o.start_time IS NOT NULL AND o.end_time IS NOT NULL
        THEN EXTRACT(EPOCH FROM (o.end_time::TIME - o.start_time::TIME)) / 3600.0
      ELSE 0
    END
  ), 0) INTO v_month_ot_hours
    FROM overtime_requests o
    LEFT JOIN employees e ON e.id = o.employee_id
   WHERE COALESCE(e.organization_id, p_org_id) = p_org_id
     AND o.status = '已核准'
     AND COALESCE(o.date, o.created_at::DATE) >= v_month_start;

  -- ★ 用 helper：自動適應 min_qty / safety_stock / 都沒
  v_low_stock_count := public._stock_low_count();

  SELECT COUNT(*) INTO v_stuck_tasks_count
    FROM tasks t
    LEFT JOIN employees e ON e.id = t.assignee_id
   WHERE COALESCE(e.organization_id, p_org_id) = p_org_id
     AND t.status IN ('未開始', '進行中', '待審核')
     AND t.created_at < p_today - INTERVAL '3 days';

  SELECT COUNT(*) INTO v_expiring_contracts
    FROM employee_contracts
   WHERE organization_id = p_org_id
     AND status IN ('active', 'expiring_soon')
     AND end_date BETWEEN p_today AND p_today + 30;

  BEGIN
    SELECT COUNT(*) INTO v_doc_expiring_30d
      FROM foreign_worker_docs fwd
      JOIN foreign_worker_profiles fwp ON fwp.id = fwd.foreign_worker_id
      JOIN employees e ON e.id = fwp.employee_id
     WHERE e.organization_id = p_org_id
       AND fwd.expiry_date BETWEEN p_today AND p_today + 30;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_doc_expiring_30d := 0;
  END;

  RETURN jsonb_build_object(
    'today', p_today,
    'today_ops', jsonb_build_object(
      'revenue', jsonb_build_object('today', v_today_revenue, 'yesterday', v_yesterday_revenue, 'last_week_same', v_last_week_revenue),
      'orders', jsonb_build_object('today', v_today_orders, 'yesterday', v_yesterday_orders, 'last_week_same', v_last_week_orders),
      'avg_ticket', jsonb_build_object(
        'today', CASE WHEN v_today_orders > 0 THEN ROUND(v_today_revenue / v_today_orders, 0) ELSE 0 END,
        'yesterday', CASE WHEN v_yesterday_orders > 0 THEN ROUND(v_yesterday_revenue / v_yesterday_orders, 0) ELSE 0 END
      )
    ),
    'month_finance', jsonb_build_object(
      'ar_balance', v_ar_balance, 'ap_balance', v_ap_balance,
      'ar_overdue_count', v_ar_overdue_count, 'ar_overdue_amount', v_ar_overdue_amount,
      'revenue', v_month_revenue, 'cost', v_month_cost,
      'gross_profit', v_month_revenue - v_month_cost,
      'margin_pct', CASE WHEN v_month_revenue > 0
        THEN ROUND(((v_month_revenue - v_month_cost) / v_month_revenue) * 100, 1) ELSE 0 END,
      'last_month_margin_pct', CASE WHEN v_last_month_revenue > 0
        THEN ROUND(((v_last_month_revenue - v_last_month_cost) / v_last_month_revenue) * 100, 1) ELSE 0 END,
      'last_month_revenue', v_last_month_revenue
    ),
    'hr_health', jsonb_build_object(
      'active_count', v_active_emp,
      'term_this_month', v_term_this_month,
      'term_rate_pct', CASE WHEN v_active_emp_month_start > 0
        THEN ROUND((v_term_this_month::NUMERIC / v_active_emp_month_start) * 100, 1) ELSE 0 END,
      'attendance_rate_today', CASE WHEN v_should_attend > 0
        THEN ROUND((v_today_attend::NUMERIC / v_should_attend) * 100, 1) ELSE 0 END,
      'today_attend_count', v_today_attend,
      'should_attend_count', v_should_attend,
      'month_ot_hours', ROUND(v_month_ot_hours, 1)
    ),
    'todos', jsonb_build_object(
      'ar_overdue', jsonb_build_object('count', v_ar_overdue_count, 'amount', v_ar_overdue_amount),
      'low_stock_count', v_low_stock_count,
      'stuck_tasks_count', v_stuck_tasks_count,
      'expiring_contracts_30d', v_expiring_contracts,
      'doc_expiring_30d', v_doc_expiring_30d
    ),
    'generated_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_dashboard_overview(INT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_dashboard_overview(INT, DATE) TO authenticated, anon;


-- ═════════════════════════════════════════════════════════════════════════
-- 重寫 fn_compute_alerts：低庫存 / 缺貨 / 7 天預測 全部包 EXCEPTION
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_compute_alerts(
  p_org_id INT,
  p_today  DATE DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_alerts jsonb := '[]'::jsonb;
  v_counts jsonb;
  v_low_stock_count INT := 0;
  v_out_stock_count INT := 0;
BEGIN
  v_low_stock_count := public._stock_low_count();
  v_out_stock_count := public._stock_out_count();

  WITH all_alerts AS (
    -- 紅：立即處理
    SELECT 'critical' AS severity, 'finance' AS category, 100 AS priority,
           '應收帳款逾期 60 天以上' AS title,
           COUNT(*)::TEXT || ' 筆，總額 NT$ ' ||
             TO_CHAR(COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0), 'FM999,999,999') AS detail,
           COUNT(*) AS count,
           COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0) AS amount,
           '/finance' AS link
      FROM accounts_receivable
     WHERE status <> '已收款'
       AND due_date IS NOT NULL
       AND due_date < p_today - 60
       AND (amount - COALESCE(paid_amount, 0)) > 0
    HAVING COUNT(*) > 0

    UNION ALL
    SELECT 'critical', 'inventory', 95,
           '已缺貨 SKU',
           v_out_stock_count::TEXT || ' 個品項庫存歸零',
           v_out_stock_count, 0::NUMERIC, '/wms'
     WHERE v_out_stock_count > 0

    UNION ALL
    SELECT 'critical', 'process', 90,
           '簽核停滯超過 7 天',
           COUNT(*)::TEXT || ' 件',
           COUNT(*), 0::NUMERIC, '/approval-center'
      FROM tasks t
      LEFT JOIN employees e ON e.id = t.assignee_id
     WHERE COALESCE(e.organization_id, p_org_id) = p_org_id
       AND t.status IN ('未開始', '進行中', '待審核')
       AND t.created_at < p_today - INTERVAL '7 days'
    HAVING COUNT(*) > 0

    UNION ALL
    SELECT 'critical', 'hr', 85,
           '員工合約 7 天內到期',
           COUNT(*)::TEXT || ' 份',
           COUNT(*), 0::NUMERIC, '/hr/contracts'
      FROM employee_contracts
     WHERE organization_id = p_org_id
       AND status IN ('active', 'expiring_soon')
       AND end_date BETWEEN p_today AND p_today + 7
    HAVING COUNT(*) > 0

    -- 橘：本週留意
    UNION ALL
    SELECT 'warning', 'finance', 70,
           '應收帳款逾期 31-60 天',
           COUNT(*)::TEXT || ' 筆，總額 NT$ ' ||
             TO_CHAR(COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0), 'FM999,999,999'),
           COUNT(*),
           COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0),
           '/finance'
      FROM accounts_receivable
     WHERE status <> '已收款'
       AND due_date IS NOT NULL
       AND due_date BETWEEN p_today - 60 AND p_today - 31
       AND (amount - COALESCE(paid_amount, 0)) > 0
    HAVING COUNT(*) > 0

    UNION ALL
    SELECT 'warning', 'inventory', 65,
           '低庫存 SKU',
           v_low_stock_count::TEXT || ' 個品項低於安全庫存',
           v_low_stock_count, 0::NUMERIC, '/wms'
     WHERE v_low_stock_count > 0

    UNION ALL
    SELECT 'warning', 'process', 60,
           '簽核停滯 3-7 天',
           COUNT(*)::TEXT || ' 件',
           COUNT(*), 0::NUMERIC, '/approval-center'
      FROM tasks t
      LEFT JOIN employees e ON e.id = t.assignee_id
     WHERE COALESCE(e.organization_id, p_org_id) = p_org_id
       AND t.status IN ('未開始', '進行中', '待審核')
       AND t.created_at >= p_today - INTERVAL '7 days'
       AND t.created_at <  p_today - INTERVAL '3 days'
    HAVING COUNT(*) > 0

    UNION ALL
    SELECT 'warning', 'hr', 55,
           '員工合約 8-30 天內到期',
           COUNT(*)::TEXT || ' 份',
           COUNT(*), 0::NUMERIC, '/hr/contracts'
      FROM employee_contracts
     WHERE organization_id = p_org_id
       AND status IN ('active', 'expiring_soon')
       AND end_date BETWEEN p_today + 8 AND p_today + 30
    HAVING COUNT(*) > 0

    UNION ALL
    SELECT 'warning', 'process', 50,
           '任務已逾期',
           COUNT(*)::TEXT || ' 個',
           COUNT(*), 0::NUMERIC, '/process/tasks'
      FROM tasks t
      LEFT JOIN employees e ON e.id = t.assignee_id
     WHERE COALESCE(e.organization_id, p_org_id) = p_org_id
       AND t.status IN ('未開始', '進行中', '待審核')
       AND t.due_date IS NOT NULL
       AND t.due_date < p_today
    HAVING COUNT(*) > 0
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'severity', severity, 'category', category, 'priority', priority,
      'title', title, 'detail', detail,
      'count', count, 'amount', amount, 'link', link
    ) ORDER BY priority DESC
  ), '[]'::jsonb)
    INTO v_alerts
    FROM all_alerts;

  SELECT jsonb_build_object(
    'critical', COALESCE(SUM(CASE WHEN (a->>'severity') = 'critical' THEN 1 ELSE 0 END), 0),
    'warning',  COALESCE(SUM(CASE WHEN (a->>'severity') = 'warning'  THEN 1 ELSE 0 END), 0),
    'info',     COALESCE(SUM(CASE WHEN (a->>'severity') = 'info'     THEN 1 ELSE 0 END), 0),
    'forecast', COALESCE(SUM(CASE WHEN (a->>'severity') = 'forecast' THEN 1 ELSE 0 END), 0),
    'total',    jsonb_array_length(v_alerts)
  )
    INTO v_counts
    FROM jsonb_array_elements(v_alerts) a;

  RETURN jsonb_build_object(
    'today', p_today,
    'counts', v_counts,
    'alerts', v_alerts,
    'generated_at', NOW()
  );
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN jsonb_build_object(
    'today', p_today,
    'counts', jsonb_build_object('critical', 0, 'warning', 0, 'info', 0, 'forecast', 0, 'total', 0),
    'alerts', '[]'::jsonb,
    'error', 'partial_data',
    'generated_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_compute_alerts(INT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_compute_alerts(INT, DATE) TO authenticated, anon;


-- ═════════════════════════════════════════════════════════════════════════
-- 重寫 fn_inventory_analytics：低庫存 / 缺貨 用 helper
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_inventory_analytics(
  p_org_id INT,
  p_today  DATE DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total_skus  INT := 0;
  v_total_value NUMERIC := 0;
  v_low_stock   INT := 0;
  v_out_stock   INT := 0;
  v_abc         jsonb := '{}'::jsonb;
  v_turnover    jsonb := '[]'::jsonb;
  v_slow_movers jsonb := '[]'::jsonb;
  v_by_warehouse jsonb := '[]'::jsonb;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(quantity), 0)
    INTO v_total_skus, v_total_value
    FROM stock_levels;

  v_low_stock := public._stock_low_count();
  v_out_stock := public._stock_out_count();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'warehouse', warehouse, 'sku_count', sku_count, 'total_qty', total_qty
  ) ORDER BY sku_count DESC), '[]'::jsonb)
    INTO v_by_warehouse
    FROM (
      SELECT COALESCE(warehouse, '未分倉') AS warehouse,
             COUNT(*) AS sku_count,
             SUM(quantity) AS total_qty
        FROM stock_levels
       GROUP BY warehouse
    ) s;

  BEGIN
    WITH out_sum AS (
      SELECT sku, SUM(qty) AS total_out
        FROM inventory_transactions
       WHERE type = 'OUT' AND date >= p_today - 90
       GROUP BY sku
    ),
    ranked AS (
      SELECT sku, total_out,
             SUM(total_out) OVER (ORDER BY total_out DESC) AS cumsum,
             SUM(total_out) OVER () AS grand_total
        FROM out_sum
    ),
    classified AS (
      SELECT sku, total_out,
             CASE
               WHEN cumsum / NULLIF(grand_total, 0) <= 0.80 THEN 'A'
               WHEN cumsum / NULLIF(grand_total, 0) <= 0.95 THEN 'B'
               ELSE 'C'
             END AS class
        FROM ranked
    )
    SELECT jsonb_object_agg(class, cnt) INTO v_abc
      FROM (SELECT class, COUNT(*) AS cnt FROM classified GROUP BY class) s;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_abc := '{}'::jsonb;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'sku_code', sku_code, 'warehouse', warehouse, 'quantity', quantity
    ) ORDER BY quantity DESC), '[]'::jsonb)
      INTO v_slow_movers
      FROM (
        SELECT sl.sku_code, sl.warehouse, sl.quantity
          FROM stock_levels sl
         WHERE sl.quantity > 0
           AND NOT EXISTS (
             SELECT 1 FROM inventory_transactions it
              WHERE it.sku = sl.sku_code AND it.type = 'OUT'
                AND it.date >= p_today - 90
           )
         ORDER BY sl.quantity DESC NULLS LAST
         LIMIT 20
      ) s;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_slow_movers := '[]'::jsonb;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'sku_code', sku, 'turnover', ROUND(turnover, 2), 'out_qty', out_qty, 'avg_stock', avg_stock
    ) ORDER BY turnover DESC), '[]'::jsonb)
      INTO v_turnover
      FROM (
        SELECT it.sku,
               SUM(it.qty) AS out_qty,
               COALESCE((SELECT AVG(quantity) FROM stock_levels WHERE sku_code = it.sku), 0) AS avg_stock,
               CASE WHEN COALESCE((SELECT AVG(quantity) FROM stock_levels WHERE sku_code = it.sku), 0) > 0
                 THEN SUM(it.qty)::NUMERIC / (SELECT AVG(quantity) FROM stock_levels WHERE sku_code = it.sku)
                 ELSE 0 END AS turnover
          FROM inventory_transactions it
         WHERE it.type = 'OUT' AND it.date >= p_today - 30
         GROUP BY it.sku
         ORDER BY 4 DESC NULLS LAST
         LIMIT 10
      ) s;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_turnover := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'today', p_today,
    'total_skus', v_total_skus,
    'total_qty', v_total_value,
    'low_stock_count', v_low_stock,
    'out_of_stock_count', v_out_stock,
    'by_warehouse', v_by_warehouse,
    'abc_segments', COALESCE(v_abc, '{}'::jsonb),
    'slow_movers', v_slow_movers,
    'turnover_top10', v_turnover,
    'generated_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_inventory_analytics(INT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_inventory_analytics(INT, DATE) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
