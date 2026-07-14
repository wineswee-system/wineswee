-- 通用:流程全任務完成 → 流程自動「已完成」 — 2026-07-14
-- 問題:原自動完成只在「從流程頁按完成任務」時觸發(前端 handler)。任務若在 LIFF/其他頁/DB trigger 完成,
--   流程就卡在 100% 進行中(如 WF-000383)。改成 DB trigger,任何途徑完成都生效。
-- 範圍:僅「無完成鏈(completion_chain_id IS NULL)」的流程直接設已完成;有完成鏈的維持走簽核(前端 handler 起鏈),不動。
-- 有工單連動的(_trg_wo_project_autocomplete)並存不衝突(都設已完成,idempotent)。

CREATE OR REPLACE FUNCTION public._trg_workflow_autocomplete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = '已完成' AND COALESCE(OLD.status,'') <> '已完成' AND NEW.workflow_instance_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.workflow_instances wi
                WHERE wi.id = NEW.workflow_instance_id
                  AND wi.status = '進行中' AND wi.archived_at IS NULL
                  AND wi.completion_chain_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.tasks t
                        WHERE t.workflow_instance_id = NEW.workflow_instance_id
                          AND t.archived_at IS NULL AND t.status <> '已完成') THEN
      UPDATE public.workflow_instances
         SET status = '已完成', completed_at = now()
       WHERE id = NEW.workflow_instance_id AND status = '進行中';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_workflow_autocomplete ON public.tasks;
CREATE TRIGGER trg_workflow_autocomplete
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._trg_workflow_autocomplete();

-- 一次性回填:現有卡在 100%(進行中 + 無完成鏈 + 有任務且全數已完成)的流程 → 已完成
UPDATE public.workflow_instances wi
   SET status = '已完成', completed_at = COALESCE(wi.completed_at, now())
 WHERE wi.status = '進行中' AND wi.archived_at IS NULL AND wi.completion_chain_id IS NULL
   AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.workflow_instance_id = wi.id AND t.archived_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.workflow_instance_id = wi.id AND t.archived_at IS NULL AND t.status <> '已完成');

NOTIFY pgrst, 'reload schema';
