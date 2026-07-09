-- Tier4 補漏:fn_process_analytics_impl 加簽統計段 — 2026-07-08
-- 上一支(260000)只修了 acted_at,漏了 extra_step_count 段:approval_extra_steps 無 request_type 欄
--   (它用 source_table)→改 SELECT source_table AS request_type(GROUP BY 走 alias,
--   approval_step_history 那段的正確 request_type 不動)。此段本有 EXCEPTION fallback 故未全炸,
--   修後加簽統計才會有值。idempotent。

CREATE OR REPLACE FUNCTION public.fn_process_analytics_impl(p_org_id integer, p_today date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
               ROUND(AVG(EXTRACT(EPOCH FROM (exited_at - entered_at)) / 3600.0)::NUMERIC, 1) AS avg_hours
          FROM approval_step_history
         WHERE exited_at IS NOT NULL
           AND entered_at >= p_today - 90
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
        SELECT source_table AS request_type, COUNT(*) AS cnt
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
END $function$;

NOTIFY pgrst, 'reload schema';
