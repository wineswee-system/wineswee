-- 修:任務通知 trigger 補回 INSERT 事件 — 2026-07-17
-- 實測證實:直接打 hr-notify ✅、UPDATE 狀態→進行中 ✅、但「建立任務即進行中」不發 ❌。
-- 三段對照唯一斷點 = trigger 沒掛 INSERT。20260524070000 原本是 AFTER INSERT OR UPDATE,
-- live 卻只剩 UPDATE(推測老闆 Studio 重建 trigger 時漏 INSERT,未回填)。
-- 修法:重建 trigger 為 AFTER INSERT OR UPDATE OF status。函式本體不動。
-- 函式 guard 在 INSERT 時 OLD 全 NULL → OLD.status IS NOT DISTINCT FROM '進行中' 為 FALSE
-- → 不短路 → 正常送通知。idempotent。

DROP TRIGGER IF EXISTS trg_task_enqueue_started_notify ON public.tasks;
CREATE TRIGGER trg_task_enqueue_started_notify
  AFTER INSERT OR UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._task_enqueue_started_notify();

NOTIFY pgrst, 'reload schema';
