-- 修:刪除/歸檔工作流任務後,不會重算工作流完成狀態。
-- 現況:_trg_workflow_autocomplete 只在「任務 UPDATE → 已完成」時觸發判定;
--       若在已完成的工作流「加一個任務」→ 退回進行中,再「刪掉那個未完成任務」→ 沒人重算 → 卡在進行中。
-- 修法:新增 AFTER DELETE / AFTER UPDATE OF archived_at 的重算 trigger:任務被移除(硬刪或歸檔)後,
--       若該工作流仍進行中、無完成簽核鏈、且剩餘(未歸檔)任務全部已完成且至少剩一個 → 標已完成。

CREATE OR REPLACE FUNCTION public._trg_workflow_recompute_on_task_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_inst := OLD.workflow_instance_id;
  ELSE
    -- 只在「剛被歸檔」(archived_at 由 NULL 變有值)時處理
    IF NOT (NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL) THEN
      RETURN NEW;
    END IF;
    v_inst := NEW.workflow_instance_id;
  END IF;

  IF v_inst IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.workflow_instances wi
                  WHERE wi.id = v_inst AND wi.status = '進行中'
                    AND wi.archived_at IS NULL AND wi.completion_chain_id IS NULL)
     AND EXISTS (SELECT 1 FROM public.tasks t
                  WHERE t.workflow_instance_id = v_inst AND t.archived_at IS NULL)          -- 至少剩一個任務(空工作流不算完成)
     AND NOT EXISTS (SELECT 1 FROM public.tasks t
                      WHERE t.workflow_instance_id = v_inst
                        AND t.archived_at IS NULL AND t.status <> '已完成') THEN
    UPDATE public.workflow_instances
       SET status = '已完成', completed_at = now()
     WHERE id = v_inst AND status = '進行中';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $function$;

DROP TRIGGER IF EXISTS trg_workflow_autocomplete_on_removal ON public.tasks;
CREATE TRIGGER trg_workflow_autocomplete_on_removal
  AFTER DELETE OR UPDATE OF archived_at ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._trg_workflow_recompute_on_task_removed();

-- 一次性修好目前卡住的(進行中但所有任務已完成、無完成簽核鏈、至少剩一任務)
UPDATE public.workflow_instances wi
   SET status = '已完成', completed_at = COALESCE(wi.completed_at, now())
 WHERE wi.status = '進行中' AND wi.archived_at IS NULL AND wi.completion_chain_id IS NULL
   AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.workflow_instance_id = wi.id AND t.archived_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM public.tasks t
                    WHERE t.workflow_instance_id = wi.id AND t.archived_at IS NULL AND t.status <> '已完成');
