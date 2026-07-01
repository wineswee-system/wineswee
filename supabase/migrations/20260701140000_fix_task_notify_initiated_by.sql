-- _task_enqueue_started_notify 補傳 initiated_by（流程發起人）
-- 查 workflow_instances.started_by_id → employees.name，加進 details payload
-- 同時補傳 assignee_name / department / store / due_date / due_time
-- idempotent（CREATE OR REPLACE）

BEGIN;

CREATE OR REPLACE FUNCTION public._task_enqueue_started_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_notify_url  CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_inst_name   text;
  v_initiated_by text;
  v_service_key text;
  v_assignee_name text;
  v_dept        text;
  v_store_name  text;
  v_payload     jsonb;
BEGIN
  -- 只在 status 由非「進行中」轉成「進行中」時 fire
  IF NEW.status <> '進行中' OR OLD.status IS NOT DISTINCT FROM '進行中' THEN
    RETURN NEW;
  END IF;
  IF NEW.assignee_id IS NULL AND (NEW.assignee IS NULL OR NEW.assignee = '') THEN
    RETURN NEW;
  END IF;

  -- 拿 workflow_instance 名稱 + 發起人
  SELECT
    COALESCE(wi.store, wi.template_name),
    e_init.name
  INTO v_inst_name, v_initiated_by
  FROM public.workflow_instances wi
  LEFT JOIN public.employees e_init ON e_init.id = wi.started_by_id
  WHERE wi.id = NEW.workflow_instance_id;

  -- 拿負責人姓名 / 部門（assignee_id 優先）
  IF NEW.assignee_id IS NOT NULL THEN
    SELECT name, dept INTO v_assignee_name, v_dept
      FROM public.employees WHERE id = NEW.assignee_id LIMIT 1;
  ELSE
    SELECT name, dept INTO v_assignee_name, v_dept
      FROM public.employees WHERE name = NEW.assignee LIMIT 1;
  END IF;

  -- 門市 text（先用 task.store；若沒有再查 employee 門市）
  v_store_name := COALESCE(
    NULLIF(NEW.store, ''),
    (SELECT store FROM public.employees
      WHERE id = COALESCE(NEW.assignee_id,
        (SELECT id FROM public.employees WHERE name = NEW.assignee LIMIT 1))
      LIMIT 1)
  );

  -- vault 拿 service_role_key
  BEGIN
    SELECT decrypted_secret INTO v_service_key
      FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  IF v_service_key IS NULL THEN
    RAISE NOTICE '[_task_enqueue_started_notify] service_role_key 不在 vault，沒推 LINE';
    RETURN NEW;
  END IF;

  v_payload := jsonb_build_object(
    'employee_id',
      CASE
        WHEN NEW.assignee_id IS NOT NULL THEN NEW.assignee_id
        ELSE (SELECT id FROM public.employees WHERE name = NEW.assignee LIMIT 1)
      END,
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
      'notes',          NEW.notes
    )
  );

  PERFORM net.http_post(
    url := v_notify_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := v_payload
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[_task_enqueue_started_notify] failed: %', SQLERRM;
  RETURN NEW;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
