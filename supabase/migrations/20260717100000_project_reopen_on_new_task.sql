-- 反向:已完成的專案/流程被塞未完成任務(或任務被重開) → 自動回「進行中」— 2026-07-17
-- 補兩支正向 autocomplete 的反向缺口:
--   _trg_project_autocomplete(全任務完成→專案已完成)
--   _trg_workflow_autocomplete(全任務完成→流程已完成)
-- 觸發:INSERT 新任務 或 UPDATE 任務 status。若該任務未封存且非已完成:
--   · 其專案是「已完成」→ 專案回「進行中」+ progress 依實際完成比例重算
--   · 其流程是「已完成」→ 流程回「進行中」+ 清 completed_at
-- 一個 task 可同時掛專案與流程,故一支 trigger 兩條軌都處理。
-- 純加新 trigger,不動現有 autocomplete。封存(暫停/已取消)的專案/流程不碰。idempotent。

CREATE OR REPLACE FUNCTION public._trg_project_reopen_on_task()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL OR COALESCE(NEW.status,'') = '已完成' THEN
    RETURN NEW;
  END IF;

  -- ── 專案:已完成 → 回進行中 + 重算進度 ──
  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects p
       SET status   = '進行中',
           progress = COALESCE((
             SELECT round(100.0 * count(*) FILTER (WHERE t.status = '已完成') / NULLIF(count(*),0))
             FROM public.tasks t
             WHERE t.project_id = p.id AND t.archived_at IS NULL
           ), 0),
           updated_at = now()
     WHERE p.id = NEW.project_id
       AND p.status = '已完成';
  END IF;

  -- ── 流程:已完成 → 回進行中 + 清完成時間 ──
  IF NEW.workflow_instance_id IS NOT NULL THEN
    UPDATE public.workflow_instances wi
       SET status = '進行中', completed_at = NULL
     WHERE wi.id = NEW.workflow_instance_id
       AND wi.status = '已完成'
       AND wi.archived_at IS NULL;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_project_reopen_on_task ON public.tasks;
CREATE TRIGGER trg_project_reopen_on_task
  AFTER INSERT OR UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._trg_project_reopen_on_task();

-- ── 一次性修正:現在卡在「已完成」但其實有未完成任務的 ──
-- 專案
UPDATE public.projects p
   SET status   = '進行中',
       progress = COALESCE((
         SELECT round(100.0 * count(*) FILTER (WHERE t.status = '已完成') / NULLIF(count(*),0))
         FROM public.tasks t
         WHERE t.project_id = p.id AND t.archived_at IS NULL
       ), 0),
       updated_at = now()
 WHERE p.status = '已完成'
   AND EXISTS (SELECT 1 FROM public.tasks t
                WHERE t.project_id = p.id AND t.archived_at IS NULL AND t.status <> '已完成');

-- 流程
UPDATE public.workflow_instances wi
   SET status = '進行中', completed_at = NULL
 WHERE wi.status = '已完成' AND wi.archived_at IS NULL
   AND EXISTS (SELECT 1 FROM public.tasks t
                WHERE t.workflow_instance_id = wi.id AND t.archived_at IS NULL AND t.status <> '已完成');

NOTIFY pgrst, 'reload schema';
