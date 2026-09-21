-- ════════════════════════════════════════════════════════════════════════════
-- Layer 3 Batch 1：4 個域內分析 RPC（HR / Finance / Sales / CRM）
-- ----------------------------------------------------------------------------
-- 每支 RPC 接 p_org_id + optional p_from / p_to / p_months，回 JSON 含多個區塊。
-- 設計原則同 fn_dashboard_overview：SECURITY DEFINER、COALESCE 防 null、
-- EXCEPTION 防 schema drift（部分表/欄不存在不爆掉）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. fn_hr_analytics ─── 人資分析
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_hr_analytics(
  p_org_id INT,
  p_today  DATE DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_month_start DATE := date_trunc('month', p_today)::DATE;
  v_year_start  DATE := date_trunc('year', p_today)::DATE;
  v_struct      jsonb;
  v_salary_trend jsonb;
  v_attendance  jsonb;
  v_attrition   jsonb;
  v_overtime    jsonb;
  v_training    jsonb;
  v_active      INT;
  v_total_terms_year INT;
BEGIN
  SELECT COUNT(*) INTO v_active
    FROM employees WHERE organization_id = p_org_id AND status = '在職';

  -- ─── 員工結構：by 部門 ────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'dept', dept, 'count', cnt
  ) ORDER BY cnt DESC), '[]'::jsonb)
    INTO v_struct
    FROM (
      SELECT COALESCE(dept, '未分配') AS dept, COUNT(*) AS cnt
        FROM employees
       WHERE organization_id = p_org_id AND status = '在職'
       GROUP BY dept
    ) s;

  -- ─── 月薪資成本趨勢（近 12 個月）─────────────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'month', month, 'total', total, 'headcount', headcount
  ) ORDER BY month), '[]'::jsonb)
    INTO v_salary_trend
    FROM (
      SELECT month,
             SUM(net_salary) AS total,
             COUNT(DISTINCT COALESCE(employee_id::TEXT, employee)) AS headcount
        FROM salary_records sr
       WHERE month >= TO_CHAR(p_today - INTERVAL '12 months', 'YYYY-MM')
       GROUP BY month
    ) s;

  -- ─── 出勤率 by 部門（本月）────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'dept', dept, 'attendance_days', att_days,
    'absence_days', abs_days, 'late_count', late_cnt
  ) ORDER BY att_days DESC), '[]'::jsonb)
    INTO v_attendance
    FROM (
      SELECT COALESCE(e.dept, '未分配') AS dept,
             SUM(CASE WHEN ar.clock_in IS NOT NULL THEN 1 ELSE 0 END) AS att_days,
             SUM(CASE WHEN ar.status = '缺勤' OR ar.status = '曠職' THEN 1 ELSE 0 END) AS abs_days,
             SUM(CASE WHEN ar.status = '遲到' THEN 1 ELSE 0 END) AS late_cnt
        FROM attendance_records ar
        LEFT JOIN employees e ON e.id = ar.employee_id
                              OR (e.name = ar.employee AND e.organization_id = p_org_id)
       WHERE ar.date >= v_month_start
         AND COALESCE(e.organization_id, p_org_id) = p_org_id
       GROUP BY e.dept
    ) s;

  -- ─── 離職率：今年累計離職 / 期初員工數 ───────────────────────────
  SELECT COUNT(*) INTO v_total_terms_year
    FROM employees
   WHERE organization_id = p_org_id AND status = '離職'
     AND COALESCE(updated_at, created_at) >= v_year_start;

  v_attrition := jsonb_build_object(
    'ytd_terms', v_total_terms_year,
    'active', v_active,
    'rate_pct', CASE WHEN (v_active + v_total_terms_year) > 0
      THEN ROUND((v_total_terms_year::NUMERIC / (v_active + v_total_terms_year)) * 100, 1)
      ELSE 0 END,
    'by_month', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('month', month, 'count', cnt) ORDER BY month)
        FROM (
          SELECT TO_CHAR(COALESCE(updated_at, created_at), 'YYYY-MM') AS month, COUNT(*) AS cnt
            FROM employees
           WHERE organization_id = p_org_id AND status = '離職'
             AND COALESCE(updated_at, created_at) >= p_today - INTERVAL '12 months'
           GROUP BY 1
        ) s
    ), '[]'::jsonb)
  );

  -- ─── 加班三桶（本月：平日/休假/國定）────────────────────────────
  v_overtime := jsonb_build_object(
    'this_month_total_hours', COALESCE((
      SELECT SUM(o.hours)
        FROM overtime_requests o
        LEFT JOIN employees e ON e.id = o.employee_id
       WHERE COALESCE(e.organization_id, p_org_id) = p_org_id
         AND o.status = '已核准'
         AND COALESCE(o.date, o.created_at::DATE) >= v_month_start
    ), 0),
    'per_employee_avg', CASE WHEN v_active > 0
      THEN ROUND(COALESCE((
        SELECT SUM(o.hours) / v_active
          FROM overtime_requests o
          LEFT JOIN employees e ON e.id = o.employee_id
         WHERE COALESCE(e.organization_id, p_org_id) = p_org_id
           AND o.status = '已核准'
           AND COALESCE(o.date, o.created_at::DATE) >= v_month_start
      ), 0), 1) ELSE 0 END,
    'top_overtimers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', name, 'hours', hours))
        FROM (
          SELECT COALESCE(e.name, o.employee) AS name,
                 ROUND(SUM(o.hours)::NUMERIC, 1) AS hours
            FROM overtime_requests o
            LEFT JOIN employees e ON e.id = o.employee_id
           WHERE COALESCE(e.organization_id, p_org_id) = p_org_id
             AND o.status = '已核准'
             AND COALESCE(o.date, o.created_at::DATE) >= v_month_start
           GROUP BY 1
           ORDER BY 2 DESC NULLS LAST
           LIMIT 5
        ) s
    ), '[]'::jsonb)
  );

  -- ─── 培訓：今年人均完成數 ────────────────────────────────────────
  BEGIN
    v_training := jsonb_build_object(
      'completed_this_year', COALESCE((
        SELECT COUNT(*) FROM training_enrollments te
          JOIN employees e ON e.id = te.employee_id
         WHERE e.organization_id = p_org_id
           AND te.status = 'completed'
           AND te.completed_at >= v_year_start
      ), 0),
      'avg_per_employee', CASE WHEN v_active > 0 THEN ROUND(COALESCE((
        SELECT COUNT(*)::NUMERIC / v_active FROM training_enrollments te
          JOIN employees e ON e.id = te.employee_id
         WHERE e.organization_id = p_org_id AND te.status = 'completed'
           AND te.completed_at >= v_year_start
      ), 0), 1) ELSE 0 END
    );
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_training := jsonb_build_object('completed_this_year', 0, 'avg_per_employee', 0, 'unavailable', true);
  END;

  RETURN jsonb_build_object(
    'today', p_today,
    'active_count', v_active,
    'structure_by_dept', v_struct,
    'salary_trend', v_salary_trend,
    'attendance_by_dept', v_attendance,
    'attrition', v_attrition,
    'overtime', v_overtime,
    'training', v_training,
    'generated_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_hr_analytics(INT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_hr_analytics(INT, DATE) TO authenticated, anon;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. fn_finance_analytics ─── 財務分析
-- ════════════════════════════════════════════════════════════════════════════
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
  v_expense_by_cat jsonb;
BEGIN
  -- AR 帳齡
  SELECT jsonb_build_object(
    'current', SUM(CASE WHEN due_date >= p_today OR due_date IS NULL THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'd1_30',   SUM(CASE WHEN due_date BETWEEN p_today - 30 AND p_today - 1 THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'd31_60',  SUM(CASE WHEN due_date BETWEEN p_today - 60 AND p_today - 31 THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'd60plus', SUM(CASE WHEN due_date < p_today - 60 THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'total_balance', SUM(amount - COALESCE(paid_amount, 0))
  )
    INTO v_ar_aging
    FROM accounts_receivable
   WHERE status <> '已收款' AND (amount - COALESCE(paid_amount, 0)) > 0;

  -- AP 帳齡
  SELECT jsonb_build_object(
    'current', SUM(CASE WHEN due_date >= p_today OR due_date IS NULL THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'd1_30',   SUM(CASE WHEN due_date BETWEEN p_today - 30 AND p_today - 1 THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'd31_60',  SUM(CASE WHEN due_date BETWEEN p_today - 60 AND p_today - 31 THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'd60plus', SUM(CASE WHEN due_date < p_today - 60 THEN amount - COALESCE(paid_amount, 0) ELSE 0 END),
    'total_balance', SUM(amount - COALESCE(paid_amount, 0))
  )
    INTO v_ap_aging
    FROM accounts_payable
   WHERE status <> '已付款' AND (amount - COALESCE(paid_amount, 0)) > 0;

  -- 近 12 月營收 vs 成本 vs 毛利
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

  -- Top 10 欠款客戶
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

  -- Top 10 應付供應商
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

  -- 現金流預測（按 due_date 排程的未來 30/60/90 天）
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

  -- 費用結構 by 科目（本月，從 expenses）
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'category', category, 'amount', amount, 'count', count
    ) ORDER BY amount DESC), '[]'::jsonb)
      INTO v_expense_by_cat
      FROM (
        SELECT COALESCE(category, account_code, '未分類') AS category,
               SUM(actual_amount) AS amount, COUNT(*) AS count
          FROM expenses
         WHERE created_at >= v_month_start
         GROUP BY 1
         ORDER BY 2 DESC NULLS LAST
         LIMIT 10
      ) s;
  EXCEPTION WHEN undefined_column THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'category', category, 'amount', amount, 'count', count
    ) ORDER BY amount DESC), '[]'::jsonb)
      INTO v_expense_by_cat
      FROM (
        SELECT COALESCE(account_code, '未分類') AS category,
               SUM(amount) AS amount, COUNT(*) AS count
          FROM expenses
         WHERE created_at >= v_month_start
         GROUP BY 1
         LIMIT 10
      ) s;
  END;

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


-- ════════════════════════════════════════════════════════════════════════════
-- 3. fn_sales_analytics ─── 銷售業績
-- ════════════════════════════════════════════════════════════════════════════
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
  -- 商機漏斗
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'stage', stage, 'count', cnt, 'amount', amount
    ) ORDER BY stage_order), '[]'::jsonb)
      INTO v_funnel
      FROM (
        SELECT
          stage,
          CASE stage
            WHEN '初步接觸' THEN 1 WHEN '需求分析' THEN 2 WHEN '報價' THEN 3
            WHEN '議價' THEN 4 WHEN '贏單' THEN 5 WHEN '輸單' THEN 6
            ELSE 99 END AS stage_order,
          COUNT(*) AS cnt,
          COALESCE(SUM(amount), 0) AS amount
          FROM opportunities
         GROUP BY stage
      ) s;
  EXCEPTION WHEN undefined_table THEN
    v_funnel := '[]'::jsonb;
  END;

  -- Top 業務員（按贏單金額）
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
  EXCEPTION WHEN undefined_table THEN
    v_top_reps := '[]'::jsonb;
  END;

  -- 報價成功率（quotations vs sales_orders）
  BEGIN
    v_quote_conv := jsonb_build_object(
      'quotations_count', COALESCE((SELECT COUNT(*) FROM quotations WHERE created_at >= v_month_start - INTERVAL '5 months'), 0),
      'sales_orders_count', COALESCE((SELECT COUNT(*) FROM sales_orders WHERE created_at >= v_month_start - INTERVAL '5 months'), 0),
      'conversion_pct', CASE
        WHEN COALESCE((SELECT COUNT(*) FROM quotations WHERE created_at >= v_month_start - INTERVAL '5 months'), 0) > 0
        THEN ROUND(
          COALESCE((SELECT COUNT(*)::NUMERIC FROM sales_orders WHERE created_at >= v_month_start - INTERVAL '5 months'), 0)
          / NULLIF((SELECT COUNT(*) FROM quotations WHERE created_at >= v_month_start - INTERVAL '5 months'), 0) * 100, 1)
        ELSE 0 END
    );
  EXCEPTION WHEN undefined_table THEN
    v_quote_conv := jsonb_build_object('unavailable', true);
  END;

  -- 客單價分布（POS 本月）
  SELECT jsonb_build_object(
    'count', COUNT(*),
    'avg', ROUND(COALESCE(AVG(total), 0), 0),
    'median', ROUND(COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total), 0), 0),
    'p90', ROUND(COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY total), 0), 0),
    'max', ROUND(COALESCE(MAX(total), 0), 0)
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


-- ════════════════════════════════════════════════════════════════════════════
-- 4. fn_crm_analytics ─── CRM 分析（新）
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_crm_analytics(
  p_org_id INT,
  p_today  DATE DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total_customers INT := 0;
  v_new_this_month  INT := 0;
  v_rfm             jsonb;
  v_top_value       jsonb;
  v_churn_risk      jsonb;
  v_new_vs_old      jsonb;
BEGIN
  -- 顧客總數 / 本月新增
  BEGIN
    SELECT COUNT(*) INTO v_total_customers FROM customers;
    SELECT COUNT(*) INTO v_new_this_month FROM customers
     WHERE created_at >= date_trunc('month', p_today);
  EXCEPTION WHEN undefined_table THEN
    v_total_customers := 0;
    v_new_this_month := 0;
  END;

  -- RFM 簡化版（Recency / Frequency / Monetary）：用 pos_transactions.member_id
  BEGIN
    WITH rfm AS (
      SELECT
        member_id,
        EXTRACT(DAYS FROM (p_today - MAX(created_at)::DATE)) AS recency_days,
        COUNT(*) AS frequency,
        SUM(total) AS monetary
        FROM pos_transactions
       WHERE member_id IS NOT NULL
         AND created_at >= p_today - INTERVAL '12 months'
         AND COALESCE(status, '完成') = '完成'
       GROUP BY member_id
    ),
    scored AS (
      SELECT *,
        CASE
          WHEN recency_days <= 30 AND frequency >= 5 AND monetary >= 10000 THEN 'VIP'
          WHEN recency_days <= 60 AND frequency >= 3 THEN '常客'
          WHEN recency_days <= 90 THEN '一般'
          ELSE '流失風險'
        END AS segment
        FROM rfm
    )
    SELECT jsonb_object_agg(segment, cnt) INTO v_rfm
      FROM (SELECT segment, COUNT(*) AS cnt FROM scored GROUP BY segment) s;
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    v_rfm := '{}'::jsonb;
  END;

  -- Top 10 高貢獻顧客（近 12 月）
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'member_id', member_id, 'total_spent', total_spent,
      'visit_count', visit_count, 'last_visit', last_visit
    ) ORDER BY total_spent DESC), '[]'::jsonb)
      INTO v_top_value
      FROM (
        SELECT member_id::TEXT AS member_id,
               SUM(total) AS total_spent,
               COUNT(*) AS visit_count,
               MAX(created_at)::DATE AS last_visit
          FROM pos_transactions
         WHERE member_id IS NOT NULL
           AND created_at >= p_today - INTERVAL '12 months'
           AND COALESCE(status, '完成') = '完成'
         GROUP BY member_id
         ORDER BY 2 DESC NULLS LAST
         LIMIT 10
      ) s;
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    v_top_value := '[]'::jsonb;
  END;

  -- 流失風險顧客（90 天沒消費）
  BEGIN
    SELECT jsonb_build_object(
      'count', COUNT(*),
      'last_spent_avg', ROUND(COALESCE(AVG(last_spent), 0), 0)
    )
      INTO v_churn_risk
      FROM (
        SELECT member_id,
               EXTRACT(DAYS FROM (p_today - MAX(created_at)::DATE)) AS days_since,
               SUM(total) AS last_spent
          FROM pos_transactions
         WHERE member_id IS NOT NULL AND COALESCE(status, '完成') = '完成'
         GROUP BY member_id
        HAVING EXTRACT(DAYS FROM (p_today - MAX(created_at)::DATE)) > 90
      ) s;
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    v_churn_risk := jsonb_build_object('count', 0, 'last_spent_avg', 0);
  END;

  -- 新客 vs 老客 營收占比（本月）
  BEGIN
    WITH first_visit AS (
      SELECT member_id, MIN(created_at) AS first_at
        FROM pos_transactions WHERE member_id IS NOT NULL GROUP BY member_id
    )
    SELECT jsonb_build_object(
      'new_revenue', COALESCE(SUM(CASE
        WHEN fv.first_at >= date_trunc('month', p_today) THEN p.total ELSE 0 END), 0),
      'old_revenue', COALESCE(SUM(CASE
        WHEN fv.first_at <  date_trunc('month', p_today) THEN p.total ELSE 0 END), 0)
    )
      INTO v_new_vs_old
      FROM pos_transactions p
      JOIN first_visit fv ON fv.member_id = p.member_id
     WHERE p.created_at >= date_trunc('month', p_today)
       AND COALESCE(p.status, '完成') = '完成';
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    v_new_vs_old := jsonb_build_object('new_revenue', 0, 'old_revenue', 0);
  END;

  RETURN jsonb_build_object(
    'today', p_today,
    'total_customers', v_total_customers,
    'new_this_month', v_new_this_month,
    'rfm_segments', COALESCE(v_rfm, '{}'::jsonb),
    'top_value_customers', v_top_value,
    'churn_risk', v_churn_risk,
    'new_vs_old', v_new_vs_old,
    'generated_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_crm_analytics(INT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_crm_analytics(INT, DATE) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
