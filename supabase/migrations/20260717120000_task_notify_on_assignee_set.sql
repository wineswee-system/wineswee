-- 補發任務通知:建立時沒指派人、之後才補指派 → 補發一次 — 2026-07-17
-- 缺口:_task_enqueue_started_notify 只在「status 轉成進行中」時發,且當下沒指派人就 return。
--   若任務先建立(此時無指派人)、之後才指派(改的是 assignee_id 不是 status)→ 兩支都不觸發 → 通知永遠漏。
-- 解法(純加,不動現有 status trigger):
--   1) _task_dispatch_started_notify(task_id):自足送信函式(卡片欄位與 _task_enqueue_started_notify 一致)
--      ⚠ 若日後改卡片欄位,兩支要一起改。
--   2) 新 trigger trg_task_notify_on_assignee_set:AFTER UPDATE OF assignee_id,
--      只在「本來就進行中(無 status 轉換,那條交給既有 status trigger)+指派人從無到有/換人」補發 → 不雙發。
-- idempotent。

-- ═══ 1) 自足送信函式 ═══
CREATE OR REPLACE FUNCTION public._task_dispatch_started_notify(p_task_id int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_notify_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_anon         CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_t             public.tasks%ROWTYPE;
  v_inst_name    text;
  v_initiated_by text;
  v_assignee_name text;
  v_dept          text;
  v_emp_id        int;
  v_store_name    text;
  v_bindings      jsonb;
  v_payload       jsonb;
BEGIN
  SELECT * INTO v_t FROM public.tasks WHERE id = p_task_id;
  IF v_t.id IS NULL THEN RETURN; END IF;
  IF v_t.assignee_id IS NULL AND (v_t.assignee IS NULL OR v_t.assignee = '') THEN RETURN; END IF;

  -- workflow 名稱 + 發起人（started_by_id 優先，fallback started_by TEXT）
  SELECT COALESCE(wi.store, wi.template_name), COALESCE(e_init.name, wi.started_by)
    INTO v_inst_name, v_initiated_by
    FROM public.workflow_instances wi
    LEFT JOIN public.employees e_init ON e_init.id = wi.started_by_id
   WHERE wi.id = v_t.workflow_instance_id;

  -- 專案任務(無流程):發起人 fallback 用專案 owner
  IF v_initiated_by IS NULL AND v_t.project_id IS NOT NULL THEN
    SELECT COALESCE(e_po.name, p.owner) INTO v_initiated_by
      FROM public.projects p
      LEFT JOIN public.employees e_po ON e_po.id = p.owner_id
     WHERE p.id = v_t.project_id;
  END IF;

  -- 負責人 id / name / dept
  IF v_t.assignee_id IS NOT NULL THEN
    SELECT id, name, dept INTO v_emp_id, v_assignee_name, v_dept
      FROM public.employees WHERE id = v_t.assignee_id LIMIT 1;
  ELSE
    SELECT id, name, dept INTO v_emp_id, v_assignee_name, v_dept
      FROM public.employees WHERE name = v_t.assignee LIMIT 1;
  END IF;

  v_store_name := COALESCE(NULLIF(v_t.store, ''),
    (SELECT store FROM public.employees WHERE id = v_emp_id LIMIT 1));

  SELECT jsonb_agg(jsonb_build_object('label', form_label, 'required_status', required_status) ORDER BY id)
    INTO v_bindings
    FROM public.task_form_bindings
   WHERE task_id = v_t.id AND status <> '已完成' AND COALESCE(fill_mode, 'self') = 'self';

  v_payload := jsonb_build_object(
    'employee_id', COALESCE(v_emp_id, 0),
    'type', 'task_auto_started',
    'details', jsonb_build_object(
      'task_id',        v_t.id,
      'task_title',     v_t.title,
      'workflow_name',  v_inst_name,
      'initiated_by',   v_initiated_by,
      'assignee_name',  COALESCE(v_assignee_name, v_t.assignee),
      'department',     v_dept,
      'store',          v_store_name,
      'due_date',       v_t.due_date,
      'due_time',       v_t.due_time,
      'description',    v_t.description,
      'notes',          v_t.notes,
      'bindings',       COALESCE(v_bindings, '[]'::jsonb)
    )
  );

  PERFORM net.http_post(
    url := v_notify_url,
    body := v_payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon),
    timeout_milliseconds := 5000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[_task_dispatch_started_notify] failed: %', SQLERRM;
END $$;

-- ═══ 2) 補指派時補發 ═══
CREATE OR REPLACE FUNCTION public._task_notify_on_assignee_set()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- 只在「本來就進行中(無 status 轉換)+ 指派人從無到有/換人」補發;
  -- 有 status 轉換的交給既有 _task_enqueue_started_notify,避免雙發。
  IF COALESCE(NEW.status, '') = '進行中'
     AND COALESCE(OLD.status, '') = '進行中'
     AND NEW.assignee_id IS NOT NULL
     AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    PERFORM public._task_dispatch_started_notify(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_notify_on_assignee_set ON public.tasks;
CREATE TRIGGER trg_task_notify_on_assignee_set
  AFTER UPDATE OF assignee_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._task_notify_on_assignee_set();

NOTIFY pgrst, 'reload schema';
