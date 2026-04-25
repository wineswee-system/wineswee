-- ============================================================
-- expense_requests 加 workflow_instance_id FK
--
-- 之前 ExpenseRequests.jsx approve/reject 用 (template_name + started_by) 模糊匹配
-- 對應的 workflow_instance — 同人多筆並存時會誤改別筆的 instance。
--
-- 加 FK 之後可以精準對應，approve/reject 直接用 req.workflow_instance_id。
-- ============================================================

ALTER TABLE public.expense_requests
  ADD COLUMN IF NOT EXISTS workflow_instance_id INT REFERENCES public.workflow_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_requests_workflow ON public.expense_requests(workflow_instance_id);

COMMENT ON COLUMN public.expense_requests.workflow_instance_id IS
  '對應的簽核流程實例。提交時 createApprovalWorkflow 回傳的 instance.id 會寫回此欄位。';
