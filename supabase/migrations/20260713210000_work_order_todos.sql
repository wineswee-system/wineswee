-- 跨部門工單「我的待辦」— 儀表板用 — 2026-07-13
-- 只回「當下輪到我動作」的工單:目標部門待受理 / 我承辦處理中 / 我申請已完成待確認。
-- 依優先級(高→低)、單號排序。SECURITY DEFINER,靠 current_employee_id 認人。

CREATE OR REPLACE FUNCTION public.web_list_my_work_order_todos()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me int := current_employee_id(); v_dept int;
BEGIN
  IF v_me IS NULL THEN RETURN '[]'::json; END IF;
  SELECT department_id INTO v_dept FROM public.employees WHERE id = v_me;
  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id', w.id, 'title', w.title, 'status', w.status, 'priority', w.priority,
      'requester_name', w.requester_name, 'requester_department_name', w.requester_department_name,
      'target_department_name', w.target_department_name, 'assignee_name', w.assignee_name,
      'expected_due_date', w.expected_due_date, 'scheduled_due_date', w.scheduled_due_date,
      'my_action', CASE
        WHEN w.status = '待受理' THEN 'accept'
        WHEN w.status = '處理中' THEN 'complete'
        WHEN w.status = '已完成' THEN 'confirm' END
    ) ORDER BY CASE w.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, w.id DESC)
    FROM public.work_orders w
    WHERE w.deleted_at IS NULL AND (
      (w.status = '待受理' AND w.target_department_id = v_dept)
      OR (w.status = '處理中' AND (w.assignee_id = v_me OR w.target_department_id = v_dept))
      OR (w.status = '已完成' AND w.requester_id = v_me)
    )
  ), '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.web_list_my_work_order_todos() TO authenticated;
NOTIFY pgrst, 'reload schema';
