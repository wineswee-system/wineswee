-- 修：刪除專案被 workflow_instances FK 擋
-- 2026-07-02
-- workflow_instances.project_id 建立時(20260417000004)沒帶 ON DELETE 子句 → 預設 NO ACTION
--   → 專案底下有流程時，刪專案報 FK 違反、刪不掉。
-- tasks.project_id 是 ON DELETE SET NULL（對），workflow 漏了。
-- 刪除專案的原意就是「解除流程/任務連結」→ 改成 SET NULL（流程保留、只解連結）。
-- idempotent。

ALTER TABLE public.workflow_instances
  DROP CONSTRAINT IF EXISTS workflow_instances_project_id_fkey;

ALTER TABLE public.workflow_instances
  ADD CONSTRAINT workflow_instances_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
