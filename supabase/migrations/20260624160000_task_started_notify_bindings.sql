-- ════════════════════════════════════════════════════════════════════════════
-- 步驟啟動 LINE 卡帶上「需完成表單」
-- 2026-06-24
--
-- 問題：流程步驟 cascade 變「進行中」時推的 task_auto_started 卡只有任務資訊，
--       沒列出該步驟綁的表單 → 執行人收到卡不知道要填/核銷什麼。
--       (binding 卡 task_with_bindings_assigned 是在「綁定 INSERT」時推，部署時
--        對還沒輪到的步驟過早推，輪到時的啟動卡反而沒表單。)
-- 修法：_task_enqueue_started_notify 查該任務「未完成」的綁定表單，塞進 details.bindings，
--       由 hr-notify buildTaskAutoStarted 一併渲染。純加法、idempotent。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._task_enqueue_started_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_notify_url  CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_inst_name   text;
  v_service_key text;
  v_emp_name    text;
  v_emp_dept    text;
  v_emp_id      int;
  v_bindings    jsonb;
  v_payload     jsonb;
BEGIN
  IF NEW.status <> '進行中' OR OLD.status IS NOT DISTINCT FROM '進行中' THEN
    RETURN NEW;
  END IF;
  IF NEW.assignee_id IS NULL AND (NEW.assignee IS NULL OR NEW.assignee = '') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(wi.store, wi.template_name)
    INTO v_inst_name
    FROM public.workflow_instances wi
   WHERE wi.id = NEW.workflow_instance_id;

  IF NEW.assignee_id IS NOT NULL THEN
    SELECT id, name, dept INTO v_emp_id, v_emp_name, v_emp_dept
      FROM public.employees WHERE id = NEW.assignee_id LIMIT 1;
  ELSE
    SELECT id, name, dept INTO v_emp_id, v_emp_name, v_emp_dept
      FROM public.employees WHERE name = NEW.assignee LIMIT 1;
  END IF;

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

  -- ★ 該步驟「尚未完成」的綁定表單（執行人填的才列；他人填的由各自的指派卡通知）
  SELECT jsonb_agg(jsonb_build_object('label', form_label, 'required_status', required_status) ORDER BY id)
    INTO v_bindings
    FROM public.task_form_bindings
   WHERE task_id = NEW.id
     AND status <> '已完成'
     AND COALESCE(fill_mode, 'self') <> 'other';

  v_payload := jsonb_build_object(
    'employee_id', COALESCE(v_emp_id, 0),
    'type', 'task_auto_started',
    'details', jsonb_build_object(
      'task_id',       NEW.id,
      'task_title',    NEW.title,
      'workflow_name', v_inst_name,
      'due_date',      NEW.due_date,
      'due_time',      NEW.due_time,
      'description',   NEW.description,
      'notes',         NEW.notes,
      'store',         NEW.store,
      'assignee_name', v_emp_name,
      'department',    v_emp_dept,
      'bindings',      COALESCE(v_bindings, '[]'::jsonb)
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
