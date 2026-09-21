-- ════════════════════════════════════════════════════════════════════════════
-- fn_compute_alerts — 預警中心：把散在各模組的「該處理的事」集中算
-- ----------------------------------------------------------------------------
-- 回傳 4 級分類 alerts，每筆含：
--   severity  : critical(紅) / warning(橘) / info(黃) / forecast(藍)
--   category  : finance / inventory / process / hr / forecast
--   title     : 主要訊息
--   detail    : 細節（金額 / 人名 / SKU 等）
--   count     : 影響筆數（可選）
--   amount    : 金額（可選）
--   link      : 前端路徑（給按鈕跳轉）
--   priority  : 排序權重（數字越大越優先）
-- ----------------------------------------------------------------------------
-- 設計：用 UNION ALL 把各規則丟進來，方便將來新增；外層 ORDER BY priority DESC
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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
BEGIN
  WITH all_alerts AS (
    -- ════ 紅：立即處理 ════════════════════════════════════════════════
    -- 1. 帳齡 60 天+
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
    -- 2. 庫存 = 0（完全沒貨）
    SELECT 'critical', 'inventory', 95,
           '已缺貨 SKU',
           COUNT(*)::TEXT || ' 個品項庫存歸零',
           COUNT(*), 0::NUMERIC, '/wms'
      FROM stock_levels
     WHERE COALESCE(quantity, 0) <= 0
       AND COALESCE(min_qty, 0) > 0
    HAVING COUNT(*) > 0

    UNION ALL
    -- 3. 簽核停滯 > 7 天
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
    -- 4. 員工合約 7 天內到期
    SELECT 'critical', 'hr', 85,
           '員工合約 7 天內到期',
           COUNT(*)::TEXT || ' 份',
           COUNT(*), 0::NUMERIC, '/hr/contracts'
      FROM employee_contracts
     WHERE organization_id = p_org_id
       AND status IN ('active', 'expiring_soon')
       AND end_date BETWEEN p_today AND p_today + 7
    HAVING COUNT(*) > 0

    -- ════ 橘：本週留意 ════════════════════════════════════════════════
    UNION ALL
    -- 5. 帳齡 31-60 天
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
    -- 6. 低庫存（接近安全量但未歸零）
    SELECT 'warning', 'inventory', 65,
           '低庫存 SKU',
           COUNT(*)::TEXT || ' 個品項低於安全庫存',
           COUNT(*), 0::NUMERIC, '/wms'
      FROM stock_levels
     WHERE COALESCE(quantity, 0) > 0
       AND COALESCE(quantity, 0) <= COALESCE(min_qty, 0)
       AND COALESCE(min_qty, 0) > 0
    HAVING COUNT(*) > 0

    UNION ALL
    -- 7. 簽核停滯 3-7 天
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
    -- 8. 員工合約 8-30 天內到期
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
    -- 9. 任務逾期（due_date 已過但未完成）
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

    -- ════ 黃：趨勢警示 ════════════════════════════════════════════════
    UNION ALL
    -- 10. 本月薪資成本相對上月變化超過 10%
    SELECT 'info', 'hr', 40,
           '本月薪資成本變化',
           '本月 ' ||
             TO_CHAR(COALESCE((SELECT SUM(net_salary) FROM salary_records
                                WHERE month = TO_CHAR(p_today, 'YYYY-MM')), 0), 'FM999,999,999') ||
           ' vs 上月 ' ||
             TO_CHAR(COALESCE((SELECT SUM(net_salary) FROM salary_records
                                WHERE month = TO_CHAR(p_today - INTERVAL '1 month', 'YYYY-MM')), 0), 'FM999,999,999'),
           0, 0::NUMERIC, '/analytics/hr'
     WHERE EXISTS (SELECT 1 FROM salary_records LIMIT 1)
       AND ABS(
         COALESCE((SELECT SUM(net_salary) FROM salary_records
                    WHERE month = TO_CHAR(p_today, 'YYYY-MM')), 0)
         - COALESCE((SELECT SUM(net_salary) FROM salary_records
                      WHERE month = TO_CHAR(p_today - INTERVAL '1 month', 'YYYY-MM')), 0)
       ) > COALESCE((SELECT SUM(net_salary) * 0.10 FROM salary_records
                      WHERE month = TO_CHAR(p_today - INTERVAL '1 month', 'YYYY-MM')), 0)

    -- ════ 藍：7 天預測（簡化版：用近 30 天平均日銷量推算） ═════════════
    UNION ALL
    -- 11. 預測 7 天內可能缺貨的 SKU（庫存 / 近 30 天日均出貨 < 7）
    SELECT 'forecast', 'forecast', 30,
           '7 天內預計缺貨 SKU',
           COUNT(*)::TEXT || ' 個品項按目前日銷量推算將缺貨',
           COUNT(*), 0::NUMERIC, '/wms'
      FROM (
        SELECT sl.sku_code,
               sl.quantity,
               COALESCE((
                 SELECT SUM(it.qty) / 30.0
                   FROM inventory_transactions it
                  WHERE it.sku = sl.sku_code
                    AND it.type = 'OUT'
                    AND it.date >= p_today - 30
               ), 0) AS daily_out
          FROM stock_levels sl
         WHERE COALESCE(sl.quantity, 0) > 0
      ) p
     WHERE p.daily_out > 0
       AND p.quantity / p.daily_out < 7
    HAVING COUNT(*) > 0
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'severity', severity,
      'category', category,
      'priority', priority,
      'title', title,
      'detail', detail,
      'count', count,
      'amount', amount,
      'link', link
    ) ORDER BY priority DESC
  ), '[]'::jsonb)
    INTO v_alerts
    FROM all_alerts;

  -- 統計各 severity 數量（給前端 badge）
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
  -- 某些表還沒建（例如 inventory_transactions）→ 回基本骨架但不爆掉
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

COMMIT;

NOTIFY pgrst, 'reload schema';
