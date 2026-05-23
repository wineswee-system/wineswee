-- ════════════════════════════════════════════════════════════════════════════
-- 修正：employees 沒有 updated_at 欄位，導致 fn_dashboard_overview /
--      fn_hr_analytics / fn_attrition_impact 全部 400 炸掉
-- ----------------------------------------------------------------------------
-- 改為：
--   · 「離職日期」優先用 severance_records.termination_date（如果有資遣紀錄）
--   · 沒有則 fallback 到 employees.created_at（粗略，但不會炸）
--
-- 用 helper view v_employee_termination 統一邏輯
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── helper view: 每位「離職」員工的 termination_date ────────────────────
CREATE OR REPLACE VIEW public.v_employee_termination AS
SELECT
  e.id            AS employee_id,
  e.name,
  e.dept,
  e.organization_id,
  COALESCE(sr.termination_date, e.created_at::DATE) AS termination_date
  FROM public.employees e
  LEFT JOIN LATERAL (
    SELECT termination_date FROM public.severance_records
     WHERE employee_id = e.id
     ORDER BY termination_date DESC LIMIT 1
  ) sr ON true
 WHERE e.status = '離職';

GRANT SELECT ON public.v_employee_termination TO authenticated, anon;


-- ─── fn_dashboard_overview：完整 CREATE OR REPLACE ───────────────────────
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
    INTO v_month_cost FROM accounts_payable
   WHERE created_at >= v_month_start;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_last_month_cost FROM accounts_payable
   WHERE created_at >= v_last_month_start AND created_at < v_month_start;

  SELECT COUNT(*) INTO v_active_emp
    FROM employees WHERE organization_id = p_org_id AND status = '在職';

  -- ★ FIX: 用 v_employee_termination view 取代 updated_at
  SELECT COUNT(*) INTO v_term_this_month
    FROM v_employee_termination
   WHERE organization_id = p_org_id
     AND termination_date >= v_month_start;

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
  ), 0)
    INTO v_month_ot_hours
    FROM overtime_requests o
    LEFT JOIN employees e ON e.id = o.employee_id
   WHERE COALESCE(e.organization_id, p_org_id) = p_org_id
     AND o.status = '已核准'
     AND COALESCE(o.date, o.created_at::DATE) >= v_month_start;

  SELECT COUNT(*) INTO v_low_stock_count
    FROM stock_levels
   WHERE COALESCE(quantity, 0) <= COALESCE(min_qty, 0)
     AND COALESCE(min_qty, 0) > 0;

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


-- ─── fn_hr_analytics 重寫（用 view 取代 updated_at）─────────────────────
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object('dept', dept, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
    INTO v_struct
    FROM (
      SELECT COALESCE(dept, '未分配') AS dept, COUNT(*) AS cnt
        FROM employees
       WHERE organization_id = p_org_id AND status = '在職'
       GROUP BY dept
    ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'month', month, 'total', total, 'headcount', headcount
  ) ORDER BY month), '[]'::jsonb)
    INTO v_salary_trend
    FROM (
      SELECT month, SUM(net_salary) AS total,
             COUNT(DISTINCT COALESCE(employee_id::TEXT, employee)) AS headcount
        FROM salary_records sr
       WHERE month >= TO_CHAR(p_today - INTERVAL '12 months', 'YYYY-MM')
       GROUP BY month
    ) s;

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

  -- ★ FIX: 用 v_employee_termination
  SELECT COUNT(*) INTO v_total_terms_year
    FROM v_employee_termination
   WHERE organization_id = p_org_id AND termination_date >= v_year_start;

  v_attrition := jsonb_build_object(
    'ytd_terms', v_total_terms_year,
    'active', v_active,
    'rate_pct', CASE WHEN (v_active + v_total_terms_year) > 0
      THEN ROUND((v_total_terms_year::NUMERIC / (v_active + v_total_terms_year)) * 100, 1)
      ELSE 0 END,
    'by_month', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('month', month, 'count', cnt) ORDER BY month)
        FROM (
          SELECT TO_CHAR(termination_date, 'YYYY-MM') AS month, COUNT(*) AS cnt
            FROM v_employee_termination
           WHERE organization_id = p_org_id
             AND termination_date >= p_today - INTERVAL '12 months'
           GROUP BY 1
        ) s
    ), '[]'::jsonb)
  );

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


-- ─── fn_attrition_impact 重寫（用 view 取代 updated_at）─────────────────
CREATE OR REPLACE FUNCTION public.fn_attrition_impact(
  p_org_id INT,
  p_today  DATE DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'employee_id', emp_id,
    'name', name,
    'dept', dept,
    'terminated_at', terminated_at,
    'open_opportunities', open_opps,
    'open_opp_value', open_opp_value,
    'pending_tasks', pending_tasks
  ) ORDER BY (open_opp_value + pending_tasks * 1000) DESC), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT
        vt.employee_id AS emp_id,
        vt.name,
        vt.dept,
        vt.termination_date AS terminated_at,
        COALESCE((
          SELECT COUNT(*) FROM opportunities o
           WHERE o.assignee = vt.name
             AND o.stage NOT IN ('贏單', '輸單')
        ), 0) AS open_opps,
        COALESCE((
          SELECT SUM(o.amount) FROM opportunities o
           WHERE o.assignee = vt.name
             AND o.stage NOT IN ('贏單', '輸單')
        ), 0) AS open_opp_value,
        COALESCE((
          SELECT COUNT(*) FROM tasks t
           WHERE t.assignee_id = vt.employee_id
             AND t.status IN ('未開始', '進行中', '待審核')
        ), 0) AS pending_tasks
        FROM v_employee_termination vt
       WHERE vt.organization_id = p_org_id
         AND vt.termination_date >= p_today - INTERVAL '12 months'
    ) s
   WHERE open_opps > 0 OR pending_tasks > 0;

  RETURN jsonb_build_object(
    'today', p_today,
    'items', v_result,
    'generated_at', NOW()
  );
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN jsonb_build_object(
    'today', p_today,
    'items', '[]'::jsonb,
    'error', 'partial_data',
    'generated_at', NOW()
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_attrition_impact(INT, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_attrition_impact(INT, DATE) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
