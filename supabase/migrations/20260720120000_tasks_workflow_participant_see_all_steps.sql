-- 流程參與者可見整條流程所有步驟 — 2026-07-20
-- 現況不一致:workflow_instances_sel 已有 has_task_in_workflow(參與者看得到流程本身),
--   但 tasks_sel 沒有對應條件 → 參與者進到流程只看得到「自己那一步」,其餘步驟被 RLS 擋
--   → 流程詳情看起來只有 1 步、像壞掉(陳姵璇是 task6 負責人卻看不到 1-5/7-8)。
-- 修法:純「加一條 permissive SELECT policy」。Postgres 多條 permissive policy 以 OR 疊加,
--   所以不動、也不覆寫現有 tasks_sel(避免洗掉 Studio 可能的漂移),只補參與者這條可見性。
--   條件走既有 SECURITY DEFINER helper has_task_in_workflow(繞 tasks RLS,無遞迴)。
-- idempotent。

DROP POLICY IF EXISTS tasks_sel_wf_participant ON public.tasks;
CREATE POLICY tasks_sel_wf_participant ON public.tasks FOR SELECT USING (
  workflow_instance_id IS NOT NULL
  AND has_task_in_workflow(workflow_instance_id::bigint)
);

NOTIFY pgrst, 'reload schema';
