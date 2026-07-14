-- 通用:專案全任務完成 → 專案自動「已完成」 — 2026-07-14
-- 跟流程同套:任務任何途徑完成 → 若該專案(進行中/規劃中)所有任務都已完成 → 設 status='已完成'(跳「已完成」分頁)。
-- 封存(暫停/已取消)的專案不動。與工單自動完成(_trg_wo_project_autocomplete)並存不衝突(idempotent)。

CREATE OR REPLACE FUNCTION public._trg_project_autocomplete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = '已完成' AND COALESCE(OLD.status,'') <> '已完成' AND NEW.project_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.projects p
                WHERE p.id = NEW.project_id AND p.status IN ('進行中','規劃中'))
       AND EXISTS (SELECT 1 FROM public.tasks t
                    WHERE t.project_id = NEW.project_id AND t.archived_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.tasks t
                        WHERE t.project_id = NEW.project_id AND t.archived_at IS NULL AND t.status <> '已完成') THEN
      UPDATE public.projects
         SET status = '已完成', progress = 100, updated_at = now()
       WHERE id = NEW.project_id AND status IN ('進行中','規劃中');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_project_autocomplete ON public.tasks;
CREATE TRIGGER trg_project_autocomplete
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._trg_project_autocomplete();

-- 一次性回填:現有卡在 100%(進行中/規劃中 + 有任務且全數已完成)的專案 → 已完成
UPDATE public.projects p
   SET status = '已完成', progress = 100, updated_at = now()
 WHERE p.status IN ('進行中','規劃中')
   AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.project_id = p.id AND t.archived_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.project_id = p.id AND t.archived_at IS NULL AND t.status <> '已完成');

NOTIFY pgrst, 'reload schema';
