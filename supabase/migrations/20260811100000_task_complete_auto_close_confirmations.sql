-- 任務標「已完成」時自動關閉底下 pending 待確認(避免殭屍卡儀表板)+ 回填現有 — 2026-08-11
-- 用 auto_closed:儀表板只濾 pending→消失;sync trigger 只認 approved/rejected→跳過不發LINE不推進
CREATE OR REPLACE FUNCTION public._trg_task_close_pending_confirmations() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.status IN ('已完成','completed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.task_confirmations
       SET status = 'auto_closed', responded_at = now(),
           notes = COALESCE(notes || E'\n', '') || '任務已完成，系統自動關閉待確認'
     WHERE task_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_task_close_pending_confirmations ON public.tasks;
CREATE TRIGGER trg_task_close_pending_confirmations
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._trg_task_close_pending_confirmations();

-- 回填:現有「任務已完成/completed 但確認還 pending」
UPDATE public.task_confirmations tc
   SET status = 'auto_closed', responded_at = now(),
       notes = COALESCE(tc.notes || E'\n', '') || '任務已完成，系統自動關閉待確認'
 WHERE tc.status = 'pending'
   AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = tc.task_id AND t.status IN ('已完成','completed'));
