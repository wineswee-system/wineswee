-- workflow_instances 補 triggered_by_task_id 欄位 — 2026-07-23
-- ════════════════════════════════════════════════════════════════════════════
-- 錯誤:42703 column workflow_instances.triggered_by_task_id does not exist。
-- 前端「任務↔流程連結」功能(TaskRelationsTab 從任務建流程 + TaskDetailPanel/TaskModal
-- 顯示「此任務觸發的流程」)引用此欄,但欄位從沒建(現有的是 triggered_by_instance_id,
-- 那是 instance→instance 鏈,語意不同)→ 查詢/寫入一直噴 42703、功能無效。
-- 補上 nullable 欄位(存觸發此流程的 task id)+ 部分索引供 .eq 查詢。
-- 不設 FK(避免任務刪除時連動;僅存值供關聯查詢)。
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.workflow_instances
  ADD COLUMN IF NOT EXISTS triggered_by_task_id bigint;

CREATE INDEX IF NOT EXISTS idx_workflow_instances_triggered_by_task
  ON public.workflow_instances(triggered_by_task_id)
  WHERE triggered_by_task_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
