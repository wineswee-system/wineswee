-- ════════════════════════════════════════════════════════════════════════════
-- 修正：fn_process_analytics rejection_rate「ORDER BY position 4」越界
-- ----------------------------------------------------------------------------
-- 內層 SELECT 只有 3 個欄位（template / total / rejected），卻 ORDER BY 4
-- → 改成 ORDER BY rejected DESC（被退回最多的模板優先）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

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

  -- ★ FIX: 內層只有 3 欄（template/total/rejected），不能 ORDER BY 4
  --   改成被退回最多的模板優先
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'template', template, 'total', total, 'rejected', rejected,
      'reject_pct', CASE WHEN total > 0 THEN ROUND((rejected::NUMERIC / total) * 100, 1) ELSE 0 END
    ) ORDER BY (CASE WHEN total > 0 THEN rejected::NUMERIC / total ELSE 0 END) DESC), '[]'::jsonb)
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
         ORDER BY rejected DESC NULLS LAST
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
         ORDER BY cnt DESC
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
