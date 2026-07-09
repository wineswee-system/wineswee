-- Tier4 analytics(可直接修 2 支):真實欄位對齊 — 2026-07-08
-- fn_hr_analytics_impl:training_enrollments 用 employee(姓名文字)非 employee_id → join 改 e.name=te.employee。
-- fn_process_analytics_impl:approval_step_history 真欄 entered_at/exited_at(無 acted_at/created_at)
--   → 簽核速度改 exited_at-entered_at、篩 entered_at。其餘不動。idempotent。

CREATE OR REPLACE FUNCTION public.fn_hr_analytics_impl(p_org_id integer, p_today date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          JOIN employees e ON e.name = te.employee
         WHERE e.organization_id = p_org_id
           AND te.status = 'completed'
           AND te.completed_at >= v_year_start
      ), 0),
      'avg_per_employee', CASE WHEN v_active > 0 THEN ROUND(COALESCE((
        SELECT COUNT(*)::NUMERIC / v_active FROM training_enrollments te
          JOIN employees e ON e.name = te.employee
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
END $function$;

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
END $function$;

NOTIFY pgrst, 'reload schema';
