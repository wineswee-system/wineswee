-- ════════════════════════════════════════════════════════════════════════════
-- task_form_bindings 強化：(1) 首次綁定 LINE 通知 (2) 擋手動跳過完成
-- ────────────────────────────────────────────────────────────────────────────
-- (1) 通知：任務剛被綁定表單時，推 LINE 給 assignee
--     一個任務同 transaction 多個 binding INSERT 只推一次（atomic claim）
-- (2) 守門：BEFORE UPDATE OF status on tasks，如果改成「已完成」但還有未完成
--     的 binding → RAISE EXCEPTION 擋下來。
--     自動完成路徑 (_check_task_bindings_complete) 不會觸發，因為它只在全部
--     binding 已完成才下 UPDATE。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1a. tasks 加旗標：是否已推過綁定 LINE ───────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS bindings_notified_at TIMESTAMPTZ;


-- ─── 1b. 通知 helper：推一張 LINE 卡列出所有綁定表單 ─────────────────────
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

  -- 解 assignee_id（優先用 assignee_id，否則用 assignee 名字反查）
  v_assignee_id := COALESCE(
    v_task.assignee_id,
    (SELECT id FROM employees WHERE name = v_task.assignee
       AND organization_id = v_task.organization_id LIMIT 1)
  );
  IF v_assignee_id IS NULL THEN RETURN 0; END IF;

  -- 預檢 LINE（沒綁就不打 edge function，省一次無謂呼叫；liff_id 留給 hr-notify 自己抓）
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


-- ─── 1c. AFTER INSERT trigger 同 transaction 只推一次 ────────────────────
CREATE OR REPLACE FUNCTION public._trg_task_binding_first_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_claimed BOOLEAN;
BEGIN
  -- atomic claim: 只有第一個進來的 INSERT 會把 bindings_notified_at 從 NULL 設成 NOW()
  UPDATE tasks SET bindings_notified_at = NOW()
   WHERE id = NEW.task_id AND bindings_notified_at IS NULL
  RETURNING true INTO v_claimed;

  IF v_claimed IS TRUE THEN
    -- 排到 transaction commit 後才推（避免 binding 還沒全寫完就推到一半）
    -- 用 PG_AFTER_TRANSACTION 不存在，改用直接 PERFORM，trigger 內呼叫即可
    PERFORM public._notify_task_bindings_assigned(NEW.task_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_binding_first_notify ON public.task_form_bindings;
CREATE TRIGGER trg_task_binding_first_notify
  AFTER INSERT ON public.task_form_bindings
  FOR EACH ROW EXECUTE FUNCTION public._trg_task_binding_first_notify();


-- ─── 2. BEFORE UPDATE on tasks：擋手動跳過綁定完成 ───────────────────────
CREATE OR REPLACE FUNCTION public._trg_task_block_complete_with_pending_bindings()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- 只在「改成已完成」時檢查
  IF NEW.status = '已完成' AND OLD.status IS DISTINCT FROM '已完成' THEN
    IF EXISTS (
      SELECT 1 FROM task_form_bindings
       WHERE task_id = NEW.id AND status <> '已完成'
    ) THEN
      RAISE EXCEPTION '任務還有未完成的綁定表單，請先填完再完成任務'
        USING HINT = '查看任務詳情的「需完成表單」清單';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_block_complete_pending_bindings ON public.tasks;
CREATE TRIGGER trg_task_block_complete_pending_bindings
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._trg_task_block_complete_with_pending_bindings();


COMMIT;

NOTIFY pgrst, 'reload schema';
