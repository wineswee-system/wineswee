-- ════════════════════════════════════════════════════════════════════════════
-- _task_enqueue_started_notify trigger 改推 rich payload
-- ────────────────────────────────────────────────────────────────────────────
-- 之前 trigger 只塞 3 個欄位（task_id / task_title / workflow_name）給 hr-notify，
-- 但 buildTaskAutoStarted 已支援 due_date / due_time / description / notes /
-- store / department / assignee_name 等 rich 欄位 → 之前推出來的卡只剩最低限。
--
-- 前端 Workflows.jsx 之前 status→'進行中' 時還會自己 notifyTaskAssignee 推一張
-- rich 卡（雙推 + 樣式不同）。這次 trigger 改推 rich 後，前端那 2 處可拔掉
-- （在另一個 commit 處理），LINE 卡片變成單一來源、樣式統一。
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
  v_payload     jsonb;
BEGIN
  -- 只在 status 由非「進行中」轉成「進行中」時 fire
  IF NEW.status <> '進行中' OR OLD.status IS NOT DISTINCT FROM '進行中' THEN
    RETURN NEW;
  END IF;
  IF NEW.assignee_id IS NULL AND (NEW.assignee IS NULL OR NEW.assignee = '') THEN
    RETURN NEW;
  END IF;

  -- 拿 workflow_instance 名稱（store 優先）
  SELECT COALESCE(wi.store, wi.template_name)
    INTO v_inst_name
    FROM public.workflow_instances wi
   WHERE wi.id = NEW.workflow_instance_id;

  -- 解 assignee id / name / dept（assignee_id 沒設時，用 assignee 名字反查）
  IF NEW.assignee_id IS NOT NULL THEN
    SELECT id, name, dept INTO v_emp_id, v_emp_name, v_emp_dept
      FROM public.employees WHERE id = NEW.assignee_id LIMIT 1;
  ELSE
    SELECT id, name, dept INTO v_emp_id, v_emp_name, v_emp_dept
      FROM public.employees WHERE name = NEW.assignee LIMIT 1;
  END IF;

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

  -- ★ rich payload：把 hr-notify buildTaskAutoStarted 支援的欄位都塞滿
  -- 比舊版多了：due_date / due_time / description / notes / store / assignee_name / department
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
      'department',    v_emp_dept
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

COMMENT ON FUNCTION public._task_enqueue_started_notify IS
  'task → 進行中時推 LINE。Rich payload 涵蓋 due/description/notes/store/dept，跟 buildTaskAutoStarted 對齊。';

NOTIFY pgrst, 'reload schema';
