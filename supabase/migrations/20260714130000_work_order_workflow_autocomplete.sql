-- 工單綁流程也要自動完成 — 2026-07-14
-- 問題:系統沒有「流程全任務完成→流程已完成」機制,所以 trg_wo_workflow_autocomplete(監 workflow_instances.status)
--   永遠不觸發。改成:tasks 完成觸發器同時處理專案 + 流程 —— 流程全任務完成→流程設已完成+工單完成。
-- 重寫 _trg_wo_project_autocomplete(原只做專案),加流程分支。trg_wo_workflow_autocomplete 保留(其他途徑設已完成時仍有效)。

CREATE OR REPLACE FUNCTION public._trg_wo_project_autocomplete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo_id int; v_total int; v_done int;
BEGIN
  IF NEW.status <> '已完成' OR COALESCE(OLD.status,'') = '已完成' THEN
    RETURN NEW;
  END IF;

  -- ── 專案:所有(未封存)任務完成 → 專案已完成 + 工單完成 ──
  IF NEW.project_id IS NOT NULL THEN
    SELECT id INTO v_wo_id FROM public.work_orders
     WHERE linked_project_id = NEW.project_id AND status = '處理中' AND deleted_at IS NULL LIMIT 1;
    IF v_wo_id IS NOT NULL THEN
      SELECT count(*), count(*) FILTER (WHERE status = '已完成')
        INTO v_total, v_done
        FROM public.tasks WHERE project_id = NEW.project_id AND archived_at IS NULL;
      IF v_total > 0 AND v_done = v_total THEN
        UPDATE public.projects SET status = '已完成', progress = 100, updated_at = now() WHERE id = NEW.project_id;
        UPDATE public.work_orders SET status = '已完成', completed_at = now(), updated_at = now() WHERE id = v_wo_id;
      END IF;
    END IF;
  END IF;

  -- ── 流程:所有(未封存)任務完成 → 流程已完成 + 工單完成 ──
  IF NEW.workflow_instance_id IS NOT NULL THEN
    SELECT id INTO v_wo_id FROM public.work_orders
     WHERE linked_workflow_instance_id = NEW.workflow_instance_id AND status = '處理中' AND deleted_at IS NULL LIMIT 1;
    IF v_wo_id IS NOT NULL THEN
      SELECT count(*), count(*) FILTER (WHERE status = '已完成')
        INTO v_total, v_done
        FROM public.tasks WHERE workflow_instance_id = NEW.workflow_instance_id AND archived_at IS NULL;
      IF v_total > 0 AND v_done = v_total THEN
        UPDATE public.workflow_instances SET status = '已完成', completed_at = now() WHERE id = NEW.workflow_instance_id;
        UPDATE public.work_orders SET status = '已完成', completed_at = now(), updated_at = now() WHERE id = v_wo_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
