-- _task_enqueue_started_notify v3
-- 修正:
--   1. initiated_by 改用 COALESCE(e_init.name, wi.started_by) —— started_by_id 為 NULL 時用 TEXT 欄位
--   2. 補回 bindings（在 trigger 端查 task_form_bindings，hr-notify 那邊只是備援）
--      hr-notify 的 !Array.isArray 判斷只有在 bindings key 完全不在 payload 才跑，
--      所以 trigger 送 null 會被判成 truthy ——直接在 trigger 側統一拿
-- idempotent

CREATE OR REPLACE FUNCTION public._task_enqueue_started_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_notify_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_inst_name    text;
  v_initiated_by text;
  v_service_key  text;
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

  -- 拿 workflow_instance 名稱 + 發起人
  -- started_by_id 優先（JOIN employees），fallback 用 started_by TEXT
  SELECT
    COALESCE(wi.store, wi.template_name),
    COALESCE(e_init.name, wi.started_by)
  INTO v_inst_name, v_initiated_by
  FROM public.workflow_instances wi
  LEFT JOIN public.employees e_init ON e_init.id = wi.started_by_id
  WHERE wi.id = NEW.workflow_instance_id;

  -- 拿負責人 id / name / dept
  IF NEW.assignee_id IS NOT NULL THEN
    SELECT id, name, dept INTO v_emp_id, v_assignee_name, v_dept
      FROM public.employees WHERE id = NEW.assignee_id LIMIT 1;
  ELSE
    SELECT id, name, dept INTO v_emp_id, v_assignee_name, v_dept
      FROM public.employees WHERE name = NEW.assignee LIMIT 1;
  END IF;

  -- 門市：task.store 優先，再查 assignee 的門市
  v_store_name := COALESCE(
    NULLIF(NEW.store, ''),
    (SELECT store FROM public.employees
      WHERE id = COALESCE(NEW.assignee_id, v_emp_id)
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

  -- 此任務尚未完成的表單綁定（self 填的才列；other 由指派通知負責）
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
    'employee_id', COALESCE(v_emp_id,
      (SELECT id FROM public.employees WHERE name = NEW.assignee LIMIT 1), 0),
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

NOTIFY pgrst, 'reload schema';
