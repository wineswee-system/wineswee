-- pj-57「宏匯思源廣場展店專案」原地修復(舊 RPC 部署壞掉的那包)— 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- pj-57 是舊版 deploy_project_template 部署的,壞在:7 流程全部進行中、54 任務無負責人、
--   成員只有林巧玉。此 migration 把它救回正確狀態(不刪資料,0% 進度不受影響)。
--
-- ⚠️ 注意:任務的「per-task 負責人」在壞掉的部署當下就沒被寫入(assignee_id 全 null),已遺失、
--   無法還原。這裡退回「該流程負責人(started_by)」作為任務負責人 —— 這正是修好後的 RPC 在
--   沒設 per-task 時會產生的值。若你當初有針對個別任務指定不同的人,救不回來,
--   那種情況建議「刪掉重部署」。
--
-- 流程負責人(started_by)已在:選址/審核/租約/裝潢收尾=林巧玉、裝潢施工=陳虹、
--   試賣/開幕=周容甄。
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) 流程層 trigger + 狀態:第一個流程(選址)進行中+manual;其餘 未開始+on_prev_wf_complete ──
UPDATE public.workflow_instances
   SET start_trigger = CASE WHEN sort_order = 1 THEN 'manual' ELSE 'on_prev_wf_complete' END
 WHERE project_id = 57;

UPDATE public.workflow_instances
   SET status = '未開始', started_at = NULL
 WHERE project_id = 57 AND sort_order > 1 AND status = '進行中';

-- ── 2) 非第一個流程「誤進進行中」的任務 → 待處理(先做,避免下一步設負責人時誤觸發通知)──
UPDATE public.tasks t
   SET status = '待處理', started_at = NULL
  FROM public.workflow_instances wi
 WHERE t.workflow_instance_id = wi.id
   AND wi.project_id = 57 AND wi.sort_order > 1 AND t.status = '進行中';

-- ── 3) 任務負責人回填:用流程 started_by 解析 → assignee_id(sync trigger 反推文字)──
UPDATE public.tasks t
   SET assignee_id = public._resolve_emp_id_by_name(wi.started_by, t.organization_id)
  FROM public.workflow_instances wi
 WHERE t.workflow_instance_id = wi.id
   AND wi.project_id = 57
   AND t.assignee_id IS NULL
   AND wi.started_by IS NOT NULL;

-- ── 4) 成員同步:流程負責人 + 任務指派人(去重,不覆蓋既有)──
INSERT INTO public.project_members (project_id, employee_id, employee_name, role, added_by, organization_id)
SELECT DISTINCT 57, e.id, e.name, 'member', 'pj57修復',
       (SELECT organization_id FROM public.projects WHERE id = 57)
  FROM (
    SELECT public._resolve_emp_id_by_name(started_by, organization_id) AS eid
      FROM public.workflow_instances WHERE project_id = 57
    UNION
    SELECT assignee_id FROM public.tasks WHERE project_id = 57 AND assignee_id IS NOT NULL
  ) x
  JOIN public.employees e ON e.id = x.eid
 WHERE x.eid IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.project_members pm
                    WHERE pm.project_id = 57 AND pm.employee_id = e.id);

-- 驗證:
-- SELECT sort_order, template_name, status, start_trigger FROM workflow_instances WHERE project_id=57 ORDER BY sort_order;
-- SELECT count(*) FILTER (WHERE assignee_id IS NULL) AS 無負責人 FROM tasks WHERE project_id=57;  -- 應=0
-- SELECT employee_name FROM project_members WHERE project_id=57;
