-- 工單待辦(輪到我動作)可見範圍收斂 — 2026-07-14
-- 原本「待受理/處理中」用 target_department_id = v_dept → 整個目標部門的人都跳待辦。
-- 改為:
--   待受理 → 有指定承辦人(assignee_id)只該人看到;未指定(只指到部門)則只該部門主管(departments.manager_id)看到。
--   處理中 → 承辦人本人。
--   已完成 → 申請人本人(不變)。
-- 只收斂「待辦清單」,不影響 WorkOrders 頁 / LIFF 瀏覽的部門透明可見性(那是另一套 RLS)。
-- 通知(work_order_notify)本來就只發給 manager_id + assignee,與此一致。idempotent。

CREATE OR REPLACE FUNCTION public.web_list_my_work_order_todos()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me int := current_employee_id();
BEGIN
  IF v_me IS NULL THEN RETURN '[]'::json; END IF;
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
      -- 待受理:指定承辦人→只該人;未指定→只目標部門主管
      (w.status = '待受理' AND (
         (w.assignee_id IS NOT NULL AND w.assignee_id = v_me)
         OR (w.assignee_id IS NULL AND v_me = (
              SELECT d.manager_id FROM public.departments d WHERE d.id = w.target_department_id))
      ))
      -- 處理中:承辦人本人
      OR (w.status = '處理中' AND w.assignee_id = v_me)
      -- 已完成:申請人本人待確認結案
      OR (w.status = '已完成' AND w.requester_id = v_me)
    )
  ), '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.web_list_my_work_order_todos() TO authenticated;
NOTIFY pgrst, 'reload schema';
