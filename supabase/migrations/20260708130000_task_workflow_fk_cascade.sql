-- 刪流程 → 底下步驟任務一起刪
-- 2026-07-08
-- 現況：tasks.workflow_instance_id FK 是 ON DELETE SET NULL（20260416000003）→
--   刪 workflow_instance 時任務不會刪，只把 workflow_instance_id 設 NULL 變孤兒任務，
--   前端只是把它從畫面 state 濾掉，DB 裡還飄著。
-- 需求(A)：刪流程 → 該流程的步驟任務一起刪掉。
-- 做法：把該 FK 改成 ON DELETE CASCADE。任務子表(comments/mentions/checklist/
--   attachments/form_bindings/依賴/子任務…)全是 CASCADE，會乾淨連鎖；CASCADE 刪不受
--   child RLS 影響，涵蓋所有刪流程入口(Projects/ProjectDetailPanel/DeployWizard)。
-- 注意：只動 tasks，不碰 expense_requests.workflow_instance_id（那個 SET NULL 要保留，
--   刪流程不該刪費用申請單）。idempotent。

BEGIN;

DO $$
DECLARE
  c_name text;
BEGIN
  -- 找出目前掛在 tasks.workflow_instance_id 上的 FK 名稱（可能是自動命名 tasks_workflow_instance_id_fkey）
  SELECT con.conname INTO c_name
  FROM pg_constraint con
  JOIN pg_class rel        ON rel.oid = con.conrelid
  JOIN pg_namespace nsp    ON nsp.oid = rel.relnamespace
  JOIN pg_attribute att    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.contype = 'f'
    AND nsp.nspname = 'public'
    AND rel.relname = 'tasks'
    AND att.attname = 'workflow_instance_id'
  LIMIT 1;

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tasks DROP CONSTRAINT %I', c_name);
  END IF;

  -- 重建為 ON DELETE CASCADE（固定命名，之後好認）
  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_workflow_instance_id_fkey
    FOREIGN KEY (workflow_instance_id)
    REFERENCES public.workflow_instances(id)
    ON DELETE CASCADE;
END $$;

COMMIT;
