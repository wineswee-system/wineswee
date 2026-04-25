-- ============================================================
-- tasks 加 trigger_template_id_on_complete 欄位
--
-- 部署 SOP 時可設定「Step N 完成 → 自動觸發 SOP X」
-- 例：「新人到職」最後一步完成 → 觸發「轉正評估」
--
-- handleStatusChange 在任務變成「已完成」時會檢查此欄位，
-- 若有值就自動建立對應的 workflow_instance + tasks，
-- 並通知第一步負責人。
-- ============================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS trigger_template_id_on_complete INT REFERENCES public.sop_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_trigger_on_complete
  ON public.tasks(trigger_template_id_on_complete)
  WHERE trigger_template_id_on_complete IS NOT NULL;

COMMENT ON COLUMN public.tasks.trigger_template_id_on_complete IS
  '此任務完成時自動觸發的 SOP 範本。例：到職流程最後一步完成 → 觸發轉正評估';
