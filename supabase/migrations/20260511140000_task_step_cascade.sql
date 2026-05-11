-- ════════════════════════════════════════════════════════════
-- 流程任務 step_order 線性 cascade — task 完成自動推進 + 呼叫 hr-notify
--
-- 起因：流程模板一鍵建出來的 task 們沒寫 task_dependencies。原本的
-- _task_cascade_on_complete trigger 抓不到 → 下一關卡死 + 不通知。
--
-- 改法：
--   1. 新 trigger _task_advance_next_step — task UPDATE 成 '已完成'，
--      找同 workflow_instance_id + step_order + 1 的 task，'待處理'
--      → 改 '進行中' + 呼叫 hr-notify edge function (type=task_auto_started)
--   2. 不重寫 flex — 用既有 hr-notify 的 buildTaskAutoStarted（跟 Step 1
--      用的是同一條 edge function path）
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ trigger：task 完成 → 找下一個 step → 推進 + 呼叫 hr-notify ═══
CREATE OR REPLACE FUNCTION public._task_advance_next_step()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_next         tasks;
  v_inst_name    text;
  v_notify_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_service_key  text;
  v_payload      jsonb;
BEGIN
  -- 只在 status 變 '已完成' 時 fire
  IF NEW.status <> '已完成' OR OLD.status = '已完成' THEN
    RETURN NEW;
  END IF;
  IF NEW.workflow_instance_id IS NULL OR NEW.step_order IS NULL THEN
    RETURN NEW;
  END IF;

  -- 找下一個 step 的 task — 只認 '待處理'（'待簽核' 是業務上等簽，不推）
  SELECT * INTO v_next FROM public.tasks
   WHERE workflow_instance_id = NEW.workflow_instance_id
     AND step_order = NEW.step_order + 1
     AND status = '待處理'
   ORDER BY id LIMIT 1;

  IF v_next.id IS NULL THEN
    RETURN NEW;  -- 沒下一關，或下一關已經在跑
  END IF;

  -- 推進 status
  UPDATE public.tasks
     SET status     = '進行中',
         started_at = COALESCE(started_at, now())
   WHERE id = v_next.id;

  -- 呼叫 hr-notify edge function（type=task_auto_started）— 用既有 flex 模板
  IF v_next.assignee_id IS NOT NULL THEN
    SELECT template_name INTO v_inst_name FROM public.workflow_instances WHERE id = NEW.workflow_instance_id;

    -- 拿 service_role key 做 edge function 呼叫（vault 取，避免 hardcode）
    BEGIN
      SELECT decrypted_secret INTO v_service_key
        FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_service_key := NULL;
    END;

    IF v_service_key IS NOT NULL THEN
      v_payload := jsonb_build_object(
        'employee_id', v_next.assignee_id,
        'type', 'task_auto_started',
        'details', jsonb_build_object(
          'task_id', v_next.id,                     -- edge function hydrate 用
          'task_title', v_next.title,
          'workflow_name', v_inst_name,
          'completed_tasks', jsonb_build_array(NEW.title)
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
    ELSE
      RAISE NOTICE '[_task_advance_next_step] service_role_key 不在 vault，沒推 LINE';
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- 不阻斷 main UPDATE
  RAISE NOTICE '[_task_advance_next_step] failed: %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_advance_next_step ON public.tasks;
CREATE TRIGGER trg_task_advance_next_step
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public._task_advance_next_step();


-- 既有「卡住但 prev step 已完成」的 task 大多是 demo / 假資料，不做 backfill。

COMMIT;

NOTIFY pgrst, 'reload schema';
