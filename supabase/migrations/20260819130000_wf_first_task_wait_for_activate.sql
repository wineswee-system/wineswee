-- ════════════════════════════════════════════════════════════════════════════
-- 流程未啟動時第一步別搶跑 — 2026-08-19
-- ════════════════════════════════════════════════════════════════════════════
-- 問題:_task_auto_start_on_insert 只要沒有未完成前置步驟就把任務設進行中,第一步
--   永遠符合 → 連「未開始」的流程(等前流程完成 or 手動啟動)第一步也被設成進行中。
--   例:裝潢收尾/試賣/開幕 流程 status=未開始,第一步卻進行中 → 流程沒輪到、任務卻在跑。
-- 修:① 插入時若所屬流程=未開始 → 第一步維持待處理;
--     ② 新 trigger:流程 未開始→進行中(手動啟動 or 前流程完成自動)時,帶起第一個待處理任務
--        (冪等:已有任務在跑就不動,與既有 _trg_activate_next_workflow 不重複);
--     ③ 修既有資料:未開始流程底下被誤設進行中的任務,退回待處理。
-- ════════════════════════════════════════════════════════════════════════════

-- ① 插入時:流程未啟動 → 第一步別搶跑
CREATE OR REPLACE FUNCTION public._task_auto_start_on_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- 已明確指定非預設狀態，不改
  IF NEW.status NOT IN ('待處理', '未開始') THEN
    RETURN NEW;
  END IF;

  -- 獨立任務 或 專案任務（無 workflow_instance_id）→ 直接進行中
  IF NEW.workflow_instance_id IS NULL THEN
    NEW.status     := '進行中';
    NEW.started_at := COALESCE(NEW.started_at, now());
    RETURN NEW;
  END IF;

  -- ★ 所屬流程還沒啟動(未開始)→ 第一步別搶跑,維持待處理;等流程被啟動時再由 trigger 帶起
  IF EXISTS (
    SELECT 1 FROM public.workflow_instances wi
     WHERE wi.id = NEW.workflow_instance_id AND wi.status = '未開始'
  ) THEN
    RETURN NEW;
  END IF;

  -- workflow 任務：第一關（step_order IS NULL 或 0）→ 直接進行中
  IF COALESCE(NEW.step_order, 0) = 0 THEN
    NEW.status     := '進行中';
    NEW.started_at := COALESCE(NEW.started_at, now());
    RETURN NEW;
  END IF;

  -- workflow 任務：有前置 step 未完成 → 維持待處理
  IF EXISTS (
    SELECT 1 FROM public.tasks
     WHERE workflow_instance_id = NEW.workflow_instance_id
       AND step_order < NEW.step_order
       AND status NOT IN ('已完成', '已擱置', '已取消')
  ) THEN
    RETURN NEW;  -- 維持 '待處理'
  END IF;

  -- 前置全完成（或尚未插入，代表本關就是第一關）→ 進行中
  NEW.status     := '進行中';
  NEW.started_at := COALESCE(NEW.started_at, now());
  RETURN NEW;
END $function$;

-- ② 流程被啟動(未開始→進行中)時,帶起第一個待處理任務(手動啟動也吃;冪等)
CREATE OR REPLACE FUNCTION public._wf_start_first_task_on_activate()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_task_id int;
BEGIN
  IF NEW.status = '進行中' AND COALESCE(OLD.status, '') IN ('未開始', '') THEN
    -- 已有任務在跑就不動(避免與 _trg_activate_next_workflow 重複帶起/重複通知)
    IF NOT EXISTS (
      SELECT 1 FROM public.tasks
       WHERE workflow_instance_id = NEW.id AND status = '進行中' AND archived_at IS NULL
    ) THEN
      SELECT id INTO v_task_id FROM public.tasks
       WHERE workflow_instance_id = NEW.id AND archived_at IS NULL AND status = '待處理'
       ORDER BY step_order, id LIMIT 1;
      IF v_task_id IS NOT NULL THEN
        UPDATE public.tasks SET status = '進行中', started_at = now() WHERE id = v_task_id;
        INSERT INTO public.notifications (type, title, user_id)
        SELECT 'task_activated',
               format('流程「%s」已啟動,任務「%s」輪到你了', NEW.template_name, t.title),
               e.auth_user_id
          FROM public.tasks t JOIN public.employees e ON e.id = t.assignee_id
         WHERE t.id = v_task_id AND e.auth_user_id IS NOT NULL;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_wf_start_first_task_on_activate ON public.workflow_instances;
CREATE TRIGGER trg_wf_start_first_task_on_activate
  AFTER UPDATE OF status ON public.workflow_instances
  FOR EACH ROW EXECUTE FUNCTION public._wf_start_first_task_on_activate();

-- ③ 修既有資料:未開始流程底下被誤設進行中的任務 → 退回待處理(停 trigger 避免發通知/連鎖)
SET session_replication_role = 'replica';
UPDATE public.tasks t
   SET status = '待處理', started_at = NULL
 WHERE t.status = '進行中'
   AND t.workflow_instance_id IN (SELECT id FROM public.workflow_instances WHERE status = '未開始');
SET session_replication_role = 'origin';

NOTIFY pgrst, 'reload schema';
