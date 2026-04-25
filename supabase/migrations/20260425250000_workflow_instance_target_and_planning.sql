-- ============================================================
-- workflow_instances 加部署規劃 + 對象關聯欄位
--
-- 目的：把「部署 SOP」從「只選分店」升級成完整的部署規劃：
--   - 對象（target_employee_id）：例如「新人到職 SOP」對應哪位新人
--   - 時程（planned_start_date / planned_end_date）
--   - 優先度 + 備註
--
-- 也把員工 detail 頁可以反查：「這位員工是哪些進行中流程的對象」
-- ============================================================

ALTER TABLE public.workflow_instances
  ADD COLUMN IF NOT EXISTS target_employee_id  INT REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_type         TEXT,           -- 'employee' / 'customer' / 'store' / 'project' / NULL
  ADD COLUMN IF NOT EXISTS planned_start_date  DATE,
  ADD COLUMN IF NOT EXISTS planned_end_date    DATE,
  ADD COLUMN IF NOT EXISTS priority            TEXT DEFAULT '中',
  ADD COLUMN IF NOT EXISTS notes               TEXT;

CREATE INDEX IF NOT EXISTS idx_workflow_instances_target_emp
  ON public.workflow_instances(target_employee_id)
  WHERE target_employee_id IS NOT NULL;

COMMENT ON COLUMN public.workflow_instances.target_employee_id IS
  '部署對象（員工）。例：新人到職 SOP 部署時 link 到該位新人。';
COMMENT ON COLUMN public.workflow_instances.target_type IS
  '對象類型，未來支援 customer / store / project 等。NULL 表示通用流程。';
