-- ════════════════════════════════════════════════════════════════════════════
-- 修正 3 個 schema / 型別問題（一次處理）
-- ----------------------------------------------------------------------------
-- 1. fn_finance_analytics expense_by_category：
--    expenses 沒有 account_code / actual_amount → 重寫只用 amount + 動態
--    判斷 category 欄位是否存在
-- 2. fn_sales_analytics 客單價分布：
--    PERCENTILE_CONT 回 double precision，ROUND(double, int) 不存在 →
--    全部 cast 到 NUMERIC
-- 3. fn_inventory_analytics by_warehouse + slow_movers：
--    stock_levels 沒有 warehouse 欄位 → 包 EXCEPTION，無欄位回空陣列
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── helper: 偵測 expenses 表的「分類」欄位 ─────────────────────────────
CREATE OR REPLACE FUNCTION public._expenses_category_col()
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_col TEXT;
BEGIN
  SELECT column_name INTO v_col
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'expenses'
     AND column_name = ANY(ARRAY['category', 'expense_category', 'expense_type', 'type'])
   ORDER BY CASE column_name
     WHEN 'category' THEN 1 WHEN 'expense_category' THEN 2
     WHEN 'expense_type' THEN 3 WHEN 'type' THEN 4
   END
   LIMIT 1;
  RETURN v_col;
END $$;

GRANT EXECUTE ON FUNCTION public._expenses_category_col() TO authenticated, anon;


-- ═════════════════════════════════════════════════════════════════════════
-- 1. fn_finance_analytics 重寫（expense_by_category 改用動態欄位）
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_finance_analytics(
  p_org_id INT,
  p_today  DATE DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_month_start DATE := date_trunc('month', p_today)::DATE;
  v_ar_aging    jsonb;
  v_ap_aging    jsonb;
  v_trend       jsonb;
  v_top_ar      jsonb;
  v_top_ap      jsonb;
  v_cashflow    jsonb;
  v_expense_by_cat jsonb := '[]'::jsonb;
  v_cat_col     TEXT;
BEGIN
  SELECT jsonb_build_object(
    'current', SUM(CASE WHEN due_date >= p_today OR due_date IS NULL THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'd1_30',   SUM(CASE WHEN due_date BETWEEN p_today - 30 AND p_today - 1 THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'd31_60',  SUM(CASE WHEN due_date BETWEEN p_today - 60 AND p_today - 31 THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'd60plus', SUM(CASE WHEN due_date < p_today - 60 THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'total_balance', SUM(amount - COALESCE(paid_amount, 0))
  ) INTO v_ar_aging
    FROM accounts_receivable
   WHERE status <> '已收款' AND (amount - COALESCE(paid_amount, 0)) > 0;

  SELECT jsonb_build_object(
    'current', SUM(CASE WHEN due_date >= p_today OR due_date IS NULL THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'd1_30',   SUM(CASE WHEN due_date BETWEEN p_today - 30 AND p_today - 1 THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'd31_60',  SUM(CASE WHEN due_date BETWEEN p_today - 60 AND p_today - 31 THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'd60plus', SUM(CASE WHEN due_date < p_today - 60 THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'total_balance', SUM(amount - COALESCE(paid_amount, 0))
  ) INTO v_ap_aging
    FROM accounts_payable
   WHERE status <> '已付款' AND (amount - COALESCE(paid_amount, 0)) > 0;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'month', month, 'revenue', revenue, 'cost', cost,
    'gross_profit', revenue - cost,
    'margin_pct', CASE WHEN revenue > 0 THEN ROUND(((revenue - cost) / revenue) * 100, 1) ELSE 0 END
  ) ORDER BY month), '[]'::jsonb)
    INTO v_trend
    FROM (
      WITH months AS (
        SELECT TO_CHAR(generate_series(
          date_trunc('month', p_today - INTERVAL '11 months'),
          date_trunc('month', p_today),
          INTERVAL '1 month'
        ), 'YYYY-MM') AS month
      )
      SELECT m.month,
        COALESCE((SELECT SUM(paid_amount) FROM accounts_receivable
                   WHERE TO_CHAR(created_at, 'YYYY-MM') = m.month), 0) AS revenue,
        COALESCE((SELECT SUM(amount) FROM accounts_payable
                   WHERE TO_CHAR(created_at, 'YYYY-MM') = m.month), 0) AS cost
        FROM months m
    ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'customer', customer, 'balance', balance, 'count', count
  ) ORDER BY balance DESC), '[]'::jsonb)
    INTO v_top_ar
    FROM (
      SELECT COALESCE(customer, '未指定') AS customer,
             SUM(amount - COALESCE(paid_amount, 0)) AS balance,
             COUNT(*) AS count
        FROM accounts_receivable
       WHERE status <> '已收款' AND (amount - COALESCE(paid_amount, 0)) > 0
       GROUP BY customer
       ORDER BY balance DESC NULLS LAST
       LIMIT 10
    ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'supplier', supplier, 'balance', balance, 'count', count
  ) ORDER BY balance DESC), '[]'::jsonb)
    INTO v_top_ap
    FROM (
      SELECT COALESCE(supplier, '未指定') AS supplier,
             SUM(amount - COALESCE(paid_amount, 0)) AS balance,
             COUNT(*) AS count
        FROM accounts_payable
       WHERE status <> '已付款' AND (amount - COALESCE(paid_amount, 0)) > 0
       GROUP BY supplier
       ORDER BY balance DESC NULLS LAST
       LIMIT 10
    ) s;

  v_cashflow := jsonb_build_object(
    'd0_30_in',  COALESCE((SELECT SUM(amount - COALESCE(paid_amount, 0)) FROM accounts_receivable
                            WHERE status <> '已收款' AND due_date BETWEEN p_today AND p_today + 30), 0),
    'd0_30_out', COALESCE((SELECT SUM(amount - COALESCE(paid_amount, 0)) FROM accounts_payable
                            WHERE status <> '已付款' AND due_date BETWEEN p_today AND p_today + 30), 0),
    'd31_60_in', COALESCE((SELECT SUM(amount - COALESCE(paid_amount, 0)) FROM accounts_receivable
                            WHERE status <> '已收款' AND due_date BETWEEN p_today + 31 AND p_today + 60), 0),
    'd31_60_out',COALESCE((SELECT SUM(amount - COALESCE(paid_amount, 0)) FROM accounts_payable
                            WHERE status <> '已付款' AND due_date BETWEEN p_today + 31 AND p_today + 60), 0),
    'd61_90_in', COALESCE((SELECT SUM(amount - COALESCE(paid_amount, 0)) FROM accounts_receivable
                            WHERE status <> '已收款' AND due_date BETWEEN p_today + 61 AND p_today + 90), 0),
    'd61_90_out',COALESCE((SELECT SUM(amount - COALESCE(paid_amount, 0)) FROM accounts_payable
                            WHERE status <> '已付款' AND due_date BETWEEN p_today + 61 AND p_today + 90), 0)
  );

  -- ★ FIX: 動態判斷 expenses 的分類欄位，並用 EXECUTE format 組 SQL
  v_cat_col := public._expenses_category_col();
  IF v_cat_col IS NOT NULL THEN
    BEGIN
      EXECUTE format($f$
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'category', category, 'amount', amount, 'count', count
        ) ORDER BY amount DESC), '[]'::jsonb)
          FROM (
            SELECT COALESCE(%I, '未分類') AS category,
                   SUM(amount) AS amount, COUNT(*) AS count
              FROM expenses
             WHERE created_at >= %L
             GROUP BY 1
             ORDER BY 2 DESC NULLS LAST
             LIMIT 10
          ) s
      $f$, v_cat_col, v_month_start) INTO v_expense_by_cat;
    EXCEPTION WHEN OTHERS THEN
      v_expense_by_cat := '[]'::jsonb;
    END;
  ELSE
    -- 沒有 category 類欄位，就只給總額
    BEGIN
      SELECT jsonb_build_array(jsonb_build_object(
        'category', '全部費用（無分類欄位）',
        'amount', COALESCE(SUM(amount), 0),
        'count', COUNT(*)
      )) INTO v_expense_by_cat
        FROM expenses
       WHERE created_at >= v_month_start;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      v_expense_by_cat := '[]'::jsonb;
    END;
  END IF;

  RETURN jsonb_build_object(
    'today', p_today,
    'ar_aging', v_ar_aging,
    'ap_aging', v_ap_aging,
    'monthly_trend', v_trend,
    'top_ar_customers', v_top_ar,
    'top_ap_suppliers', v_top_ap,
    'cashflow_forecast', v_cashflow,
    'expense_by_category', v_expense_by_cat,
    'generated_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_finance_analytics(INT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_finance_analytics(INT, DATE) TO authenticated, anon;


-- ═════════════════════════════════════════════════════════════════════════
-- 2. fn_sales_analytics 重寫（ROUND cast 到 NUMERIC）
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_sales_analytics(
  p_org_id INT,
  p_today  DATE DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_month_start  DATE := date_trunc('month', p_today)::DATE;
  v_funnel       jsonb;
  v_top_reps     jsonb;
  v_quote_conv   jsonb;
  v_ticket_dist  jsonb;
BEGIN
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'stage', stage, 'count', cnt, 'amount', amount
    ) ORDER BY stage_order), '[]'::jsonb)
      INTO v_funnel
      FROM (
        SELECT stage,
          CASE stage
            WHEN '初步接觸' THEN 1 WHEN '需求分析' THEN 2 WHEN '報價' THEN 3
            WHEN '議價' THEN 4 WHEN '贏單' THEN 5 WHEN '輸單' THEN 6
            ELSE 99 END AS stage_order,
          COUNT(*) AS cnt,
          COALESCE(SUM(amount), 0) AS amount
          FROM opportunities
         GROUP BY stage
      ) s;
  EXCEPTION WHEN undefined_table THEN v_funnel := '[]'::jsonb;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', name, 'won_amount', won_amount, 'won_count', won_count, 'total_count', total_count
    ) ORDER BY won_amount DESC), '[]'::jsonb)
      INTO v_top_reps
      FROM (
        SELECT
          COALESCE(assignee, '未指派') AS name,
          SUM(CASE WHEN stage = '贏單' THEN amount ELSE 0 END) AS won_amount,
          SUM(CASE WHEN stage = '贏單' THEN 1 ELSE 0 END) AS won_count,
          COUNT(*) AS total_count
          FROM opportunities
         GROUP BY assignee
         ORDER BY 2 DESC NULLS LAST
         LIMIT 10
      ) s;
  EXCEPTION WHEN undefined_table THEN v_top_reps := '[]'::jsonb;
  END;

  BEGIN
    v_quote_conv := jsonb_build_object(
      'quotations_count', COALESCE((SELECT COUNT(*) FROM quotations WHERE created_at >= v_month_start - INTERVAL '5 months'), 0),
      'sales_orders_count', COALESCE((SELECT COUNT(*) FROM sales_orders WHERE created_at >= v_month_start - INTERVAL '5 months'), 0),
      'conversion_pct', CASE
        WHEN COALESCE((SELECT COUNT(*) FROM quotations WHERE created_at >= v_month_start - INTERVAL '5 months'), 0) > 0
        THEN ROUND(
          (COALESCE((SELECT COUNT(*)::NUMERIC FROM sales_orders WHERE created_at >= v_month_start - INTERVAL '5 months'), 0)
          / NULLIF((SELECT COUNT(*) FROM quotations WHERE created_at >= v_month_start - INTERVAL '5 months'), 0) * 100)::NUMERIC, 1)
        ELSE 0 END
    );
  EXCEPTION WHEN undefined_table THEN
    v_quote_conv := jsonb_build_object('unavailable', true);
  END;

  -- ★ FIX: PERCENTILE_CONT 回 double，要 cast 到 NUMERIC 才能 ROUND
  SELECT jsonb_build_object(
    'count', COUNT(*),
    'avg', ROUND(COALESCE(AVG(total), 0)::NUMERIC, 0),
    'median', ROUND(COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total), 0)::NUMERIC, 0),
    'p90', ROUND(COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY total), 0)::NUMERIC, 0),
    'max', ROUND(COALESCE(MAX(total), 0)::NUMERIC, 0)
  )
    INTO v_ticket_dist
    FROM pos_transactions
   WHERE created_at >= v_month_start AND COALESCE(status, '完成') = '完成';

  RETURN jsonb_build_object(
    'today', p_today,
    'funnel', v_funnel,
    'top_reps', v_top_reps,
    'quote_conversion', v_quote_conv,
    'ticket_distribution', v_ticket_dist,
    'generated_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_sales_analytics(INT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_sales_analytics(INT, DATE) TO authenticated, anon;


-- ═════════════════════════════════════════════════════════════════════════
-- 3. fn_inventory_analytics 重寫（warehouse 欄位包 EXCEPTION）
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

  -- ★ FIX: warehouse 欄位可能不存在 → 包 EXCEPTION
  BEGIN
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
  EXCEPTION WHEN undefined_column THEN
    v_by_warehouse := '[]'::jsonb;
  END;

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

  -- ★ FIX: slow_movers 也用了 warehouse，包 EXCEPTION 失敗就回不含 warehouse 的版本
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
    -- 退而求其次：去掉 warehouse 欄位重試
    BEGIN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'sku_code', sku_code, 'warehouse', '-', 'quantity', quantity
      ) ORDER BY quantity DESC), '[]'::jsonb)
        INTO v_slow_movers
        FROM (
          SELECT sl.sku_code, sl.quantity
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
    EXCEPTION WHEN OTHERS THEN
      v_slow_movers := '[]'::jsonb;
    END;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'sku_code', sku, 'turnover', ROUND(turnover::NUMERIC, 2), 'out_qty', out_qty, 'avg_stock', avg_stock
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
