-- ════════════════════════════════════════════════════════════════════════════
-- 修正：EXTRACT(DAYS FROM (date - date)) 在 PG 不合法
-- ----------------------------------------------------------------------------
-- PG 規則：date - date = integer（天數差），EXTRACT 只接受 timestamp / interval
-- → 直接用 (date - date) 即可拿到天數整數
--
-- 影響：fn_process_analytics（流程分析整頁炸）、fn_crm_analytics（RFM/流失風險）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 重寫 fn_process_analytics：修 EXTRACT(DAYS FROM ...) → 直接 date 減
-- ═════════════════════════════════════════════════════════════════════════
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

  -- ★ FIX: (p_today - t.due_date) 直接就是 integer 天數，不要套 EXTRACT
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'task_id', id, 'title', title, 'assignee', assignee,
    'due_date', due_date, 'days_overdue', days_overdue, 'status', status
  ) ORDER BY days_overdue DESC), '[]'::jsonb)
    INTO v_overdue_tasks
    FROM (
      SELECT t.id, t.title, COALESCE(e.name, t.assignee) AS assignee,
             t.due_date,
             (p_today - t.due_date)::INT AS days_overdue,
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


-- ═════════════════════════════════════════════════════════════════════════
-- 重寫 fn_crm_analytics：修 EXTRACT(DAYS FROM ...) → 直接 date 減
-- ═════════════════════════════════════════════════════════════════════════
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
  BEGIN
    SELECT COUNT(*) INTO v_total_customers FROM customers;
    SELECT COUNT(*) INTO v_new_this_month FROM customers
     WHERE created_at >= date_trunc('month', p_today);
  EXCEPTION WHEN undefined_table THEN
    v_total_customers := 0;
    v_new_this_month := 0;
  END;

  -- RFM 簡化版（用 pos_transactions.member_id）
  -- ★ FIX: (p_today - date) 直接是 integer
  BEGIN
    WITH rfm AS (
      SELECT
        member_id,
        (p_today - MAX(created_at)::DATE)::INT AS recency_days,
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

  -- Top 10 高貢獻顧客
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
  -- ★ FIX: HAVING 直接用 date 減
  BEGIN
    SELECT jsonb_build_object(
      'count', COUNT(*),
      'last_spent_avg', ROUND(COALESCE(AVG(last_spent), 0), 0)
    )
      INTO v_churn_risk
      FROM (
        SELECT member_id,
               (p_today - MAX(created_at)::DATE)::INT AS days_since,
               SUM(total) AS last_spent
          FROM pos_transactions
         WHERE member_id IS NOT NULL AND COALESCE(status, '完成') = '完成'
         GROUP BY member_id
        HAVING (p_today - MAX(created_at)::DATE) > 90
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
