-- ════════════════════════════════════════════════════════════════════════════
-- Layer 3 Batch 2：4 個域內分析 RPC（Inventory / POS / Manufacturing / Process）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. fn_inventory_analytics ─── 庫存分析
-- ════════════════════════════════════════════════════════════════════════════
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
  -- 基本統計
  SELECT COUNT(*), COALESCE(SUM(quantity), 0)
    INTO v_total_skus, v_total_value
    FROM stock_levels;

  SELECT COUNT(*) INTO v_low_stock
    FROM stock_levels
   WHERE COALESCE(quantity, 0) > 0
     AND COALESCE(quantity, 0) <= COALESCE(min_qty, 0)
     AND COALESCE(min_qty, 0) > 0;

  SELECT COUNT(*) INTO v_out_stock
    FROM stock_levels
   WHERE COALESCE(quantity, 0) <= 0
     AND COALESCE(min_qty, 0) > 0;

  -- by 倉
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

  -- ABC 分析（用近 90 天 inventory_transactions OUT 累計，分 A/B/C 三級）
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

  -- 滯銷品（>90 天無 OUT 動）
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

  -- 庫存週轉率 Top 10（近 30 天 OUT / 平均庫存）
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


-- ════════════════════════════════════════════════════════════════════════════
-- 6. fn_pos_analytics ─── POS 門市分析
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_pos_analytics(
  p_org_id INT,
  p_today  DATE DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_week_compare jsonb;
  v_hour_heatmap jsonb;
  v_payment_mix  jsonb;
  v_store_rank   jsonb;
BEGIN
  -- 本週 vs 上週 vs 去年同週
  SELECT jsonb_build_object(
    'this_week', COALESCE((
      SELECT SUM(total) FROM pos_transactions
       WHERE created_at::DATE BETWEEN p_today - 7 AND p_today
         AND COALESCE(status, '完成') = '完成'
    ), 0),
    'last_week', COALESCE((
      SELECT SUM(total) FROM pos_transactions
       WHERE created_at::DATE BETWEEN p_today - 14 AND p_today - 8
         AND COALESCE(status, '完成') = '完成'
    ), 0),
    'last_year_same_week', COALESCE((
      SELECT SUM(total) FROM pos_transactions
       WHERE created_at::DATE BETWEEN p_today - 372 AND p_today - 365
         AND COALESCE(status, '完成') = '完成'
    ), 0)
  ) INTO v_week_compare;

  -- 時段熱力（hour 0-23 × weekday 1-7，近 30 天）
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'weekday', weekday, 'hour', hour, 'count', cnt, 'revenue', revenue
  )), '[]'::jsonb)
    INTO v_hour_heatmap
    FROM (
      SELECT EXTRACT(DOW FROM created_at)::INT AS weekday,
             EXTRACT(HOUR FROM created_at)::INT AS hour,
             COUNT(*) AS cnt,
             SUM(total) AS revenue
        FROM pos_transactions
       WHERE created_at >= p_today - 30
         AND COALESCE(status, '完成') = '完成'
       GROUP BY 1, 2
    ) s;

  -- 支付方式分布（本月）
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'method', method, 'count', cnt, 'amount', amount
  ) ORDER BY amount DESC), '[]'::jsonb)
    INTO v_payment_mix
    FROM (
      SELECT COALESCE(payment_method, '未指定') AS method,
             COUNT(*) AS cnt,
             SUM(total) AS amount
        FROM pos_transactions
       WHERE created_at >= date_trunc('month', p_today)
         AND COALESCE(status, '完成') = '完成'
       GROUP BY 1
    ) s;

  -- 門市排行（本月）
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'store', store, 'revenue', revenue, 'orders', orders, 'avg_ticket', avg_ticket
  ) ORDER BY revenue DESC), '[]'::jsonb)
    INTO v_store_rank
    FROM (
      SELECT COALESCE(store, '未指定') AS store,
             SUM(total) AS revenue,
             COUNT(*) AS orders,
             ROUND(AVG(total), 0) AS avg_ticket
        FROM pos_transactions
       WHERE created_at >= date_trunc('month', p_today)
         AND COALESCE(status, '完成') = '完成'
       GROUP BY 1
       ORDER BY 2 DESC NULLS LAST
       LIMIT 20
    ) s;

  RETURN jsonb_build_object(
    'today', p_today,
    'week_comparison', v_week_compare,
    'hour_heatmap', v_hour_heatmap,
    'payment_mix', v_payment_mix,
    'store_rank', v_store_rank,
    'generated_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_pos_analytics(INT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_pos_analytics(INT, DATE) TO authenticated, anon;


-- ════════════════════════════════════════════════════════════════════════════
-- 7. fn_manufacturing_analytics ─── 製造分析
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_manufacturing_analytics(
  p_org_id INT,
  p_today  DATE DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_orders_total INT := 0;
  v_orders_done  INT := 0;
  v_orders_progress INT := 0;
  v_quality      jsonb := '{}'::jsonb;
  v_recent_orders jsonb := '[]'::jsonb;
  v_completion_pct NUMERIC := 0;
BEGIN
  -- 製造單統計
  BEGIN
    SELECT
      COUNT(*),
      SUM(CASE WHEN status = '完成' THEN 1 ELSE 0 END),
      SUM(CASE WHEN status IN ('進行中', '生產中') THEN 1 ELSE 0 END)
      INTO v_orders_total, v_orders_done, v_orders_progress
      FROM manufacturing_orders
     WHERE created_at >= p_today - 90;

    v_completion_pct := CASE WHEN v_orders_total > 0
      THEN ROUND((v_orders_done::NUMERIC / v_orders_total) * 100, 1) ELSE 0 END;

    -- 近 10 張製造單
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'mo_number', COALESCE(order_number, id::TEXT),
      'product', product_name,
      'planned_qty', planned_qty,
      'actual_qty', actual_qty,
      'status', status,
      'created_at', created_at::DATE
    ) ORDER BY created_at DESC), '[]'::jsonb)
      INTO v_recent_orders
      FROM (
        SELECT * FROM manufacturing_orders
         ORDER BY created_at DESC LIMIT 10
      ) s;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_orders_total := 0; v_orders_done := 0; v_orders_progress := 0;
    v_recent_orders := '[]'::jsonb;
  END;

  -- 良率（quality_inspections）
  BEGIN
    SELECT jsonb_build_object(
      'total_inspected', SUM(COALESCE(inspected_qty, 0)),
      'total_defects', SUM(COALESCE(defect_qty, 0)),
      'defect_rate_pct', CASE WHEN SUM(COALESCE(inspected_qty, 0)) > 0
        THEN ROUND((SUM(COALESCE(defect_qty, 0))::NUMERIC / SUM(inspected_qty)) * 100, 2)
        ELSE 0 END
    )
      INTO v_quality
      FROM quality_inspections
     WHERE created_at >= p_today - 90;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_quality := jsonb_build_object('unavailable', true);
  END;

  RETURN jsonb_build_object(
    'today', p_today,
    'orders_90d', jsonb_build_object(
      'total', v_orders_total,
      'completed', v_orders_done,
      'in_progress', v_orders_progress,
      'completion_pct', v_completion_pct
    ),
    'quality', v_quality,
    'recent_orders', v_recent_orders,
    'generated_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_manufacturing_analytics(INT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_manufacturing_analytics(INT, DATE) TO authenticated, anon;


-- ════════════════════════════════════════════════════════════════════════════
-- 8. fn_process_analytics ─── 流程效率
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_process_analytics(
  p_org_id INT,
  p_today  DATE DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_task_completion jsonb;
  v_overdue_tasks   jsonb;
  v_signoff_speed   jsonb;
  v_rejection_rate  jsonb;
  v_extra_signers   jsonb;
BEGIN
  -- 任務完成率 by workflow template
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'template', template, 'total', total, 'done', done,
    'completion_pct', CASE WHEN total > 0 THEN ROUND((done::NUMERIC / total) * 100, 1) ELSE 0 END
  ) ORDER BY total DESC), '[]'::jsonb)
    INTO v_task_completion
    FROM (
      SELECT COALESCE(wi.template_name, '未命名') AS template,
             COUNT(t.id) AS total,
             SUM(CASE WHEN t.status = '已完成' THEN 1 ELSE 0 END) AS done
        FROM tasks t
        LEFT JOIN workflow_instances wi ON wi.id = t.workflow_instance_id
        LEFT JOIN employees e ON e.id = t.assignee_id
       WHERE COALESCE(e.organization_id, p_org_id) = p_org_id
         AND t.created_at >= p_today - 90
       GROUP BY wi.template_name
       LIMIT 20
    ) s;

  -- 逾期任務 Top 20
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'task_id', id, 'title', title, 'assignee', assignee,
    'due_date', due_date, 'days_overdue', days_overdue, 'status', status
  ) ORDER BY days_overdue DESC), '[]'::jsonb)
    INTO v_overdue_tasks
    FROM (
      SELECT t.id, t.title, COALESCE(e.name, t.assignee) AS assignee,
             t.due_date,
             EXTRACT(DAYS FROM (p_today - t.due_date))::INT AS days_overdue,
             t.status
        FROM tasks t
        LEFT JOIN employees e ON e.id = t.assignee_id
       WHERE COALESCE(e.organization_id, p_org_id) = p_org_id
         AND t.status IN ('未開始', '進行中', '待審核')
         AND t.due_date IS NOT NULL
         AND t.due_date < p_today
       ORDER BY t.due_date ASC
       LIMIT 20
    ) s;

  -- 平均簽核耗時 by 表單類型（從 approval_step_history）
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'request_type', request_type, 'count', cnt, 'avg_hours', avg_hours
    ) ORDER BY avg_hours DESC), '[]'::jsonb)
      INTO v_signoff_speed
      FROM (
        SELECT request_type,
               COUNT(*) AS cnt,
               ROUND(AVG(EXTRACT(EPOCH FROM (acted_at - created_at)) / 3600.0)::NUMERIC, 1) AS avg_hours
          FROM approval_step_history
         WHERE acted_at IS NOT NULL
           AND created_at >= p_today - 90
         GROUP BY request_type
         ORDER BY avg_hours DESC NULLS LAST
         LIMIT 10
      ) s;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_signoff_speed := '[]'::jsonb;
  END;

  -- 表單退回率 by template（form_submissions）
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'template', template, 'total', total, 'rejected', rejected,
      'reject_pct', CASE WHEN total > 0 THEN ROUND((rejected::NUMERIC / total) * 100, 1) ELSE 0 END
    ) ORDER BY reject_pct DESC), '[]'::jsonb)
      INTO v_rejection_rate
      FROM (
        SELECT COALESCE(ft.name, '未知模板') AS template,
               COUNT(*) AS total,
               SUM(CASE WHEN fs.status = '已駁回' THEN 1 ELSE 0 END) AS rejected
          FROM form_submissions fs
          LEFT JOIN form_templates ft ON ft.id = fs.template_id
         WHERE fs.organization_id = p_org_id
           AND fs.created_at >= p_today - 90
         GROUP BY ft.name
         ORDER BY 4 DESC NULLS LAST
         LIMIT 10
      ) s;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_rejection_rate := '[]'::jsonb;
  END;

  -- 加簽次數 by 表單類型（看哪些流程設計需要常常加簽）
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'request_type', request_type, 'extra_step_count', cnt
    ) ORDER BY cnt DESC), '[]'::jsonb)
      INTO v_extra_signers
      FROM (
        SELECT request_type, COUNT(*) AS cnt
          FROM approval_extra_steps
         WHERE created_at >= p_today - 90
         GROUP BY request_type
         ORDER BY 2 DESC
         LIMIT 10
      ) s;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_extra_signers := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'today', p_today,
    'task_completion_by_template', v_task_completion,
    'overdue_tasks_top20', v_overdue_tasks,
    'signoff_speed_by_type', v_signoff_speed,
    'rejection_rate_by_template', v_rejection_rate,
    'extra_signers_by_type', v_extra_signers,
    'generated_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_process_analytics(INT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_process_analytics(INT, DATE) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
