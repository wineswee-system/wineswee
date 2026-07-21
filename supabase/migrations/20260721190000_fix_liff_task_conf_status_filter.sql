-- 修:LIFF 任務確認漏撈「進行中/待處理」任務的 pending 確認 — 2026-07-21
-- 根因:liff_list_my_task_confirmations 有 `t.status IN ('待確認','已完成')`,把任務狀態非這兩者
--   (進行中/待處理)的濾掉。但任務狀態 ≠ 確認狀態:一個「進行中」的任務照樣可以有一關 pending 等人簽。
--   慘案:陳虹 DB 有 10 筆 pending 確認,RPC 只回 6 筆(漏 949/973/1169進行中 + 1188待處理)。
-- 修:拿掉任務狀態限制(tc.status='pending' 才是真訊號),只擋已軟刪任務(deleted_at)。

CREATE OR REPLACE FUNCTION public.liff_list_my_task_confirmations(p_line_user_id text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id',                  tc.id,
      'task_id',             t.id,
      'task_title',          t.title,
      'task_description',    t.description,
      'task_status',         t.status,
      'task_assignee',       t.assignee,
      'task_store',          t.store,
      'task_due_date',       t.due_date,
      'task_completed_at',   t.completed_at,
      'workflow_instance_id', t.workflow_instance_id,
      'workflow_name',       wi.template_name,
      'priority',            t.priority,
      'created_at',          tc.created_at
    ) ORDER BY tc.created_at DESC)
    FROM public.task_confirmations tc
    JOIN public.tasks t ON t.id = tc.task_id
    LEFT JOIN public.workflow_instances wi ON wi.id = t.workflow_instance_id
    WHERE tc.approver = emp.name
      AND tc.status = 'pending'
      AND (tc.organization_id IS NULL OR tc.organization_id = emp.organization_id)
      AND t.deleted_at IS NULL           -- 只擋已刪任務;任務狀態(進行中/待處理…)不擋,pending 確認就該顯示
  ), '[]'::json);
END $function$;

NOTIFY pgrst, 'reload schema';
