-- 跨部門工單 LINE 通知 — 2026-07-13
-- 觸發器讀 status 轉換決定事件 → _notify_work_order_event → net.http_post 打 hr-notify。
-- 事件→收件人:
--   created(開單)   → 目標部門主管 + (指定承辦)
--   accepted(受理)  → 申請人 + 承辦人
--   completed(完成) → 申請人
--   rejected(退回)  → 申請人
--   confirmed(結案) → 承辦人
-- flex 卡在 hr-notify Edge Function 建(禁 PG 手刻)。撤單(deleted_at)不通知。

CREATE OR REPLACE FUNCTION public._notify_work_order_event(p_id int, p_event text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url  CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_anon CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_wo      public.work_orders;
  v_mgr     int;
  v_targets int[];
  r_target  RECORD;
  v_payload jsonb;
  v_count   int := 0;
BEGIN
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN 0; END IF;
  SELECT manager_id INTO v_mgr FROM public.departments WHERE id = v_wo.target_department_id;

  v_targets := CASE p_event
    WHEN 'created'   THEN ARRAY[v_mgr, v_wo.assignee_id]
    WHEN 'accepted'  THEN ARRAY[v_wo.requester_id, v_wo.assignee_id]
    WHEN 'completed' THEN ARRAY[v_wo.requester_id]
    WHEN 'rejected'  THEN ARRAY[v_wo.requester_id]
    WHEN 'confirmed' THEN ARRAY[v_wo.assignee_id]
    ELSE ARRAY[]::int[] END;

  FOR r_target IN
    SELECT DISTINCT v.employee_id
      FROM public.v_employee_line_resolved v
     WHERE v.employee_id = ANY(v_targets) AND v.employee_id IS NOT NULL AND v.line_user_id IS NOT NULL
  LOOP
    v_payload := jsonb_build_object(
      'employee_id', r_target.employee_id,
      'type', 'work_order_' || p_event,
      'details', jsonb_build_object(
        'id', v_wo.id,
        'title', v_wo.title,
        'requester_name', v_wo.requester_name,
        'requester_department', v_wo.requester_department_name,
        'target_department', v_wo.target_department_name,
        'assignee_name', v_wo.assignee_name,
        'priority', v_wo.priority,
        'expected_due_date',  to_char(v_wo.expected_due_date, 'YYYY-MM-DD'),
        'scheduled_due_date', to_char(v_wo.scheduled_due_date, 'YYYY-MM-DD'),
        'reject_reason', v_wo.reject_reason
      )
    );
    PERFORM net.http_post(url := v_url, body := v_payload,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_anon),
      timeout_milliseconds := 5000);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public._trg_work_order_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event := 'created';
  ELSE
    -- 撤單不通知
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status THEN RETURN NEW; END IF;
    v_event := CASE NEW.status
      WHEN '處理中' THEN 'accepted'
      WHEN '已完成' THEN 'completed'
      WHEN '已結案' THEN 'confirmed'
      WHEN '已退回' THEN 'rejected'
      ELSE NULL END;
  END IF;
  IF v_event IS NOT NULL THEN
    PERFORM public._notify_work_order_event(NEW.id, v_event);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_work_order_notify ON public.work_orders;
CREATE TRIGGER trg_work_order_notify
  AFTER INSERT OR UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public._trg_work_order_notify();

NOTIFY pgrst, 'reload schema';
