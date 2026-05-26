-- ════════════════════════════════════════════════════════════════════════════
-- 修：_notify_task_bindings_assigned 不應通知狀態為「待處理」的 task
-- ----------------------------------------------------------------------------
-- 原本 trg_task_binding_first_notify 在 task_form_bindings INSERT 時，
-- 不管任務狀態，只要是第一個 binding 就推 LINE。
--
-- 問題：SOP 部署時，所有步驟的 required_forms 會一次性 INSERT。
-- 步驟 2–N 的任務狀態是「待處理」（等前一步完成才激活），
-- 但 binding trigger 照推 → 每步一則 LINE → 使用者收到 N 則通知。
--
-- 修法：在 _notify_task_bindings_assigned 加狀態檢查，
--       只有 tasks.status = '進行中' 才推。
--       等步驟被 cascade 激活時，trg_task_enqueue_started_notify 會一起通知表單資訊。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._notify_task_bindings_assigned(p_task_id INT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_url       CONSTANT TEXT := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_anon      CONSTANT TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_task      tasks;
  v_assignee_id INT;
  v_has_line  BOOLEAN;
  v_summary   jsonb;
  v_payload   jsonb;
BEGIN
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN RETURN 0; END IF;

  -- ★ 修：只通知已激活的任務（進行中）。
  --   待處理 = 尚未輪到，cascade 激活後 trg_task_enqueue_started_notify 會統一通知。
  --   其他狀態（已完成、已取消等）= 不需再推。
  IF v_task.status <> '進行中' THEN RETURN 0; END IF;

  -- 解 assignee_id（優先用 assignee_id，否則用 assignee 名字反查）
  v_assignee_id := COALESCE(
    v_task.assignee_id,
    (SELECT id FROM employees WHERE name = v_task.assignee
       AND organization_id = v_task.organization_id LIMIT 1)
  );
  IF v_assignee_id IS NULL THEN RETURN 0; END IF;

  -- 預檢 LINE（沒綁就不打 edge function，省一次無謂呼叫）
  SELECT EXISTS (
    SELECT 1 FROM v_employee_line_resolved v
     WHERE v.employee_id = v_assignee_id AND v.line_user_id IS NOT NULL
  ) INTO v_has_line;
  IF NOT v_has_line THEN RETURN 0; END IF;

  -- 收集所有綁定表單名稱
  SELECT jsonb_agg(jsonb_build_object('label', form_label, 'required_status', required_status))
    INTO v_summary
    FROM task_form_bindings
   WHERE task_id = p_task_id;

  v_payload := jsonb_build_object(
    'employee_id', v_assignee_id,
    'type', 'task_with_bindings_assigned',
    'details', jsonb_build_object(
      'task_id', p_task_id,
      'task_title', v_task.title,
      'workflow_name', (SELECT template_name FROM workflow_instances WHERE id = v_task.workflow_instance_id),
      'due_date', v_task.due_date,
      'due_time', v_task.due_time,
      'store', v_task.store,
      'bindings', v_summary
    )
  );

  PERFORM net.http_post(
    url := v_url,
    body := v_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    timeout_milliseconds := 5000
  );
  RETURN 1;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
