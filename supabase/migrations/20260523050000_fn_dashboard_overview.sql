-- ════════════════════════════════════════════════════════════════════════════
-- fn_dashboard_overview — 老闆首頁聚合 RPC（4 區塊一支搞定）
-- ----------------------------------------------------------------------------
--   區塊 1 today_ops    : 今日營收 / 訂單數 / 平均客單，含 vs 昨日 + vs 上週同日
--   區塊 2 month_finance: AR 餘額 / AP 餘額 / 本月毛利 / 上月毛利對比
--   區塊 3 hr_health    : 在職數 / 本月離職 / 出勤率 / 本月加班總時
--   區塊 4 todos        : 逾期 AR / 低庫存 / 簽核卡 >3 天 / 合約 30 天內到期
--
-- 設計原則：
--   - 全部 COALESCE(..., 0) 確保沒資料時回 0，前端不需特別處理 null
--   - SECURITY DEFINER + GRANT to authenticated（含 anon 給將來 LIFF 老闆頁）
--   - 業務表（pos_transactions / AR / AP / stock）目前 schema 無 organization_id
--     → 用單租戶假設先撈全部；HR 表（employees/contracts/tasks）以 org 過濾
--   - 大量 LATERAL CTE 把今天/昨天/上週同日/本月/上月 一次算完，少 round-trip
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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
  v_last_month_end   DATE := v_month_start - 1;

  -- 區塊 1
  v_today_revenue        NUMERIC := 0;
  v_today_orders         INT     := 0;
  v_yesterday_revenue    NUMERIC := 0;
  v_yesterday_orders     INT     := 0;
  v_last_week_revenue    NUMERIC := 0;
  v_last_week_orders     INT     := 0;

  -- 區塊 2
  v_ar_balance           NUMERIC := 0;
  v_ap_balance           NUMERIC := 0;
  v_ar_overdue_count     INT     := 0;
  v_ar_overdue_amount    NUMERIC := 0;
  v_month_revenue        NUMERIC := 0;
  v_month_cost           NUMERIC := 0;
  v_last_month_revenue   NUMERIC := 0;
  v_last_month_cost      NUMERIC := 0;

  -- 區塊 3
  v_active_emp           INT     := 0;
  v_term_this_month      INT     := 0;
  v_active_emp_month_start INT   := 0;
  v_today_attend         INT     := 0;
  v_should_attend        INT     := 0;
  v_month_ot_hours       NUMERIC := 0;

  -- 區塊 4
  v_low_stock_count      INT     := 0;
  v_stuck_tasks_count    INT     := 0;
  v_expiring_contracts   INT     := 0;
  v_doc_expiring_30d     INT     := 0;
BEGIN

  -- ─── 區塊 1：今日營運（POS + Sales Orders 都算進營收）──────────────────
  -- POS：當日 status='完成' 的 total
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

  -- ─── 區塊 2：財務 ──────────────────────────────────────────────────────
  SELECT COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0)
    INTO v_ar_balance
    FROM accounts_receivable WHERE status <> '已收款';

  SELECT COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0)
    INTO v_ap_balance
    FROM accounts_payable WHERE status <> '已付款';

  -- 逾期 AR（due_date < today 且還沒收完）
  SELECT COUNT(*), COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0)
    INTO v_ar_overdue_count, v_ar_overdue_amount
    FROM accounts_receivable
   WHERE status <> '已收款'
     AND due_date IS NOT NULL
     AND due_date < p_today
     AND (amount - COALESCE(paid_amount, 0)) > 0;

  -- 本月 / 上月 營收（AR 的 paid_amount 進帳當基準；若無 AR 用 pos 總額 fallback）
  SELECT COALESCE(SUM(paid_amount), 0)
    INTO v_month_revenue
    FROM accounts_receivable
   WHERE created_at >= v_month_start;
  IF v_month_revenue = 0 THEN
    SELECT COALESCE(SUM(total), 0) INTO v_month_revenue
      FROM pos_transactions
     WHERE created_at >= v_month_start AND COALESCE(status, '完成') = '完成';
  END IF;

  SELECT COALESCE(SUM(paid_amount), 0)
    INTO v_last_month_revenue
    FROM accounts_receivable
   WHERE created_at >= v_last_month_start AND created_at < v_month_start;
  IF v_last_month_revenue = 0 THEN
    SELECT COALESCE(SUM(total), 0) INTO v_last_month_revenue
      FROM pos_transactions
     WHERE created_at >= v_last_month_start AND created_at < v_month_start
       AND COALESCE(status, '完成') = '完成';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_month_cost
    FROM accounts_payable
   WHERE created_at >= v_month_start;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_last_month_cost
    FROM accounts_payable
   WHERE created_at >= v_last_month_start AND created_at < v_month_start;

  -- ─── 區塊 3：人力健康度 ─────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_active_emp
    FROM employees
   WHERE organization_id = p_org_id AND status = '在職';

  -- 本月離職：用 employees.status='離職' 且 updated_at 落在本月
  SELECT COUNT(*) INTO v_term_this_month
    FROM employees
   WHERE organization_id = p_org_id
     AND status = '離職'
     AND COALESCE(updated_at, created_at) >= v_month_start;

  -- 月初在職人數（簡化版：用目前在職 + 本月離職 當分母）
  v_active_emp_month_start := v_active_emp + v_term_this_month;

  -- 今日出勤：今天有打卡的人 vs 應出勤（在職且非排休）
  SELECT COUNT(DISTINCT COALESCE(ar.employee_id,
           (SELECT id FROM employees WHERE name = ar.employee
              AND organization_id = p_org_id LIMIT 1)))
    INTO v_today_attend
    FROM attendance_records ar
   WHERE ar.date = p_today AND ar.clock_in IS NOT NULL;

  v_should_attend := v_active_emp;  -- 簡化：假設都該上班

  -- 本月加班總時數（已核准）
  SELECT COALESCE(SUM(
    CASE
      WHEN o.hours IS NOT NULL THEN o.hours
      WHEN o.start_time IS NOT NULL AND o.end_time IS NOT NULL
        THEN EXTRACT(EPOCH FROM (o.end_time::TIME - o.start_time::TIME)) / 3600.0
      ELSE 0
    END
  ), 0)
    INTO v_month_ot_hours
    FROM overtime_requests o
    LEFT JOIN employees e ON e.id = o.employee_id
   WHERE COALESCE(e.organization_id, p_org_id) = p_org_id
     AND o.status = '已核准'
     AND COALESCE(o.date, o.created_at::DATE) >= v_month_start;

  -- ─── 區塊 4：要處理的事 ─────────────────────────────────────────────────
  -- 低庫存 SKU 數
  SELECT COUNT(*) INTO v_low_stock_count
    FROM stock_levels
   WHERE COALESCE(quantity, 0) <= COALESCE(min_qty, 0)
     AND COALESCE(min_qty, 0) > 0;

  -- 簽核卡 > 3 天：任務 status 仍未完成且 created_at > 3 天
  SELECT COUNT(*) INTO v_stuck_tasks_count
    FROM tasks t
    LEFT JOIN employees e ON e.id = t.assignee_id
   WHERE COALESCE(e.organization_id, p_org_id) = p_org_id
     AND t.status IN ('未開始', '進行中', '待審核')
     AND t.created_at < p_today - INTERVAL '3 days';

  -- 合約 30 天內到期
  SELECT COUNT(*) INTO v_expiring_contracts
    FROM employee_contracts
   WHERE organization_id = p_org_id
     AND status IN ('active', 'expiring_soon')
     AND end_date BETWEEN p_today AND p_today + 30;

  -- 工作許可 / 證件 30 天內到期（如果表存在）
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

  -- ─── 組裝 JSON ─────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'today', p_today,
    'today_ops', jsonb_build_object(
      'revenue', jsonb_build_object(
        'today', v_today_revenue,
        'yesterday', v_yesterday_revenue,
        'last_week_same', v_last_week_revenue
      ),
      'orders', jsonb_build_object(
        'today', v_today_orders,
        'yesterday', v_yesterday_orders,
        'last_week_same', v_last_week_orders
      ),
      'avg_ticket', jsonb_build_object(
        'today', CASE WHEN v_today_orders > 0 THEN ROUND(v_today_revenue / v_today_orders, 0) ELSE 0 END,
        'yesterday', CASE WHEN v_yesterday_orders > 0 THEN ROUND(v_yesterday_revenue / v_yesterday_orders, 0) ELSE 0 END
      )
    ),
    'month_finance', jsonb_build_object(
      'ar_balance', v_ar_balance,
      'ap_balance', v_ap_balance,
      'ar_overdue_count', v_ar_overdue_count,
      'ar_overdue_amount', v_ar_overdue_amount,
      'revenue', v_month_revenue,
      'cost', v_month_cost,
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
      'ar_overdue', jsonb_build_object(
        'count', v_ar_overdue_count,
        'amount', v_ar_overdue_amount
      ),
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

COMMIT;

NOTIFY pgrst, 'reload schema';
