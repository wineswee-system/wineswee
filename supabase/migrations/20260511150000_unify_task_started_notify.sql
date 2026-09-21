-- ════════════════════════════════════════════════════════════
-- 統一「task → 進行中」LINE 通知 — 全部走 hr-notify
--
-- 原本有兩條 path 在推「task 開始」通知，格式不一致：
--   1. _task_enqueue_started_notify (20260429000008) — task status → 進行中時
--      在 PG 內 hand-roll flex JSON 推簡化卡（無雙按鈕、無描述）
--   2. _task_advance_next_step (20260511140000) — cascade 推進時呼叫 hr-notify
--      的 task_auto_started（rich card）
--
-- 當 cascade 觸發時兩個都 fire → user 看到簡化版（老 trigger 蓋過 / 兩張都送）
--
-- 修法：
--   1. _task_enqueue_started_notify 改成呼叫 hr-notify（與 cascade trigger 一致）
--   2. _task_advance_next_step 拿掉 hr-notify 直接呼叫
--      → 統一由 _task_enqueue_started_notify 在 status=進行中 時推
--   3. 這樣不管哪條 path 把 task 改成 '進行中'（手動、cascade、其他 trigger），
--      LINE 通知都走同一個 builder
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 改寫老 trigger function — 改呼叫 hr-notify ═══
CREATE OR REPLACE FUNCTION public._task_enqueue_started_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_notify_url  CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/hr-notify';
  v_inst_name   text;
  v_service_key text;
  v_payload     jsonb;
BEGIN
  -- 只在 status 由非「進行中」轉成「進行中」時 fire
  IF NEW.status <> '進行中' OR OLD.status IS NOT DISTINCT FROM '進行中' THEN
    RETURN NEW;
  END IF;
  IF NEW.assignee_id IS NULL AND (NEW.assignee IS NULL OR NEW.assignee = '') THEN
    RETURN NEW;  -- 沒指派人就不通知
  END IF;

  -- 拿 workflow_instance 名稱（store 優先）
  SELECT COALESCE(wi.store, wi.template_name)
    INTO v_inst_name
    FROM public.workflow_instances wi
   WHERE wi.id = NEW.workflow_instance_id;

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

  -- 解 employee_id（assignee_id 沒設時，用 assignee 名字反查）
  -- 沒解到就送 0；hr-notify 內部會找不到 line user 再 fallback skip
  v_payload := jsonb_build_object(
    'employee_id',
      CASE
        WHEN NEW.assignee_id IS NOT NULL THEN NEW.assignee_id
        ELSE (SELECT id FROM public.employees WHERE name = NEW.assignee LIMIT 1)
      END,
    'type', 'task_auto_started',
    'details', jsonb_build_object(
      'task_id', NEW.id,
      'task_title', NEW.title,
      'workflow_name', v_inst_name
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


-- ═══ 2. 改 cascade trigger — 不再自己呼叫 hr-notify ═══
-- 它只負責「找下一關 + 推進 status」；通知由上面那條 trigger 接手
CREATE OR REPLACE FUNCTION public._task_advance_next_step()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_next tasks;
BEGIN
  IF NEW.status <> '已完成' OR OLD.status = '已完成' THEN
    RETURN NEW;
  END IF;
  IF NEW.workflow_instance_id IS NULL OR NEW.step_order IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_next FROM public.tasks
   WHERE workflow_instance_id = NEW.workflow_instance_id
     AND step_order = NEW.step_order + 1
     AND status = '待處理'
   ORDER BY id LIMIT 1;

  IF v_next.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 推進 status — 這個 UPDATE 會自動觸發 _task_enqueue_started_notify 推 LINE
  UPDATE public.tasks
     SET status     = '進行中',
         started_at = COALESCE(started_at, now())
   WHERE id = v_next.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[_task_advance_next_step] failed: %', SQLERRM;
  RETURN NEW;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
