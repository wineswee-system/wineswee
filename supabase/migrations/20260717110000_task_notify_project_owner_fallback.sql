-- 任務通知發起人 fallback:無流程的專案/獨立任務改用專案 owner — 2026-07-17
-- 原 _task_enqueue_started_notify 只從 workflow_instances.started_by 撈發起人,
-- 沒掛流程的任務(project_id 有、workflow_instance_id 無)→ initiated_by=NULL → 卡片沒發起人。
-- 加 fallback:撈不到流程發起人且有 project_id → 用專案負責人(owner_id 的 employee name,fallback owner TEXT)。
-- dump-live 原文 + 外科插入,不動其他邏輯。idempotent。

CREATE OR REPLACE FUNCTION public._task_enqueue_started_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_notify_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_anon         CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_inst_name    text;
  v_initiated_by text;
  v_assignee_name text;
  v_dept          text;
  v_emp_id        int;
  v_store_name    text;
  v_bindings      jsonb;
  v_payload       jsonb;
BEGIN
  IF NEW.status <> '進行中' OR OLD.status IS NOT DISTINCT FROM '進行中' THEN
    RETURN NEW;
  END IF;
  IF NEW.assignee_id IS NULL AND (NEW.assignee IS NULL OR NEW.assignee = '') THEN
    RETURN NEW;
  END IF;

  -- 拿 workflow_instance 名稱 + 發起人（started_by_id 優先，fallback started_by TEXT）
  SELECT
    COALESCE(wi.store, wi.template_name),
    COALESCE(e_init.name, wi.started_by)
  INTO v_inst_name, v_initiated_by
  FROM public.workflow_instances wi
  LEFT JOIN public.employees e_init ON e_init.id = wi.started_by_id
  WHERE wi.id = NEW.workflow_instance_id;

  -- 專案任務/獨立任務(無流程,或流程無發起人):發起人 fallback 用專案負責人 owner
  IF v_initiated_by IS NULL AND NEW.project_id IS NOT NULL THEN
    SELECT COALESCE(e_po.name, p.owner)
      INTO v_initiated_by
    FROM public.projects p
    LEFT JOIN public.employees e_po ON e_po.id = p.owner_id
    WHERE p.id = NEW.project_id;
  END IF;

  -- 拿負責人 id / name / dept
  IF NEW.assignee_id IS NOT NULL THEN
    SELECT id, name, dept INTO v_emp_id, v_assignee_name, v_dept
      FROM public.employees WHERE id = NEW.assignee_id LIMIT 1;
  ELSE
    SELECT id, name, dept INTO v_emp_id, v_assignee_name, v_dept
      FROM public.employees WHERE name = NEW.assignee LIMIT 1;
  END IF;

  -- 門市：task.store 優先，再查 employee.store
  v_store_name := COALESCE(
    NULLIF(NEW.store, ''),
    (SELECT store FROM public.employees WHERE id = v_emp_id LIMIT 1)
  );

  -- 此任務尚未完成的表單綁定（self 模式）
  SELECT jsonb_agg(
    jsonb_build_object('label', form_label, 'required_status', required_status)
    ORDER BY id
  )
  INTO v_bindings
  FROM public.task_form_bindings
  WHERE task_id = NEW.id
    AND status <> '已完成'
    AND COALESCE(fill_mode, 'self') = 'self';

  v_payload := jsonb_build_object(
    'employee_id', COALESCE(v_emp_id, 0),
    'type', 'task_auto_started',
    'details', jsonb_build_object(
      'task_id',        NEW.id,
      'task_title',     NEW.title,
      'workflow_name',  v_inst_name,
      'initiated_by',   v_initiated_by,
      'assignee_name',  COALESCE(v_assignee_name, NEW.assignee),
      'department',     v_dept,
      'store',          v_store_name,
      'due_date',       NEW.due_date,
      'due_time',       NEW.due_time,
      'description',    NEW.description,
      'notes',          NEW.notes,
      'bindings',       COALESCE(v_bindings, '[]'::jsonb)
    )
  );

  PERFORM net.http_post(
    url := v_notify_url,
    body := v_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[_task_enqueue_started_notify] failed: %', SQLERRM;
  RETURN NEW;
END $function$
;

NOTIFY pgrst, 'reload schema';
