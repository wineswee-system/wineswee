-- 跨部門工單 ↔ 專案/流程綁定 + 自動完成連動 (Phase 1) — 2026-07-13
-- 受理後可「轉專案」執行;工單完成由「裡面任務全做完」決定,不能手動關(防作弊)。
-- 連動:專案所有任務完成 → 專案自動「已完成」→ 工單自動「已完成」;流程「已完成」→ 工單「已完成」。
-- 工單狀態更新會觸發既有 trg_work_order_notify → 申請人收「請確認」卡。

-- ① 綁定欄位
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS linked_type text CHECK (linked_type IN ('project','workflow')),
  ADD COLUMN IF NOT EXISTS linked_project_id int REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_workflow_instance_id int REFERENCES public.workflow_instances(id) ON DELETE SET NULL;

-- ② 擋手動完成:綁了專案/流程的工單,不能手動「回報完成」(必須靠裡面任務跑完自動關)
CREATE OR REPLACE FUNCTION public._wo_complete(p_id int, p_actor int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (_wo_actor_is_admin(p_actor) OR v_wo.assignee_id = p_actor OR _wo_actor_dept(p_actor) = v_wo.target_department_id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_wo.status <> '處理中' THEN RETURN json_build_object('ok', false, 'error', 'NOT_IN_PROGRESS'); END IF;
  -- ★ 綁了專案/流程 → 手動完成被擋,完成由裡面任務全做完自動觸發
  IF v_wo.linked_type IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'LINKED_AUTO_ONLY'); END IF;
  UPDATE public.work_orders SET status = '已完成', completed_at = now(), updated_at = now() WHERE id = p_id;
  RETURN json_build_object('ok', true, 'status', '已完成');
END $$;

-- ③ 轉專案(核心 actor 版):受理後(處理中)才能轉,建 project + 回填綁定
CREATE OR REPLACE FUNCTION public._wo_to_project(p_id int, p_actor int, p_name text, p_description text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders; v_proj_id int; v_owner text; v_prio text;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (_wo_actor_is_admin(p_actor) OR _wo_actor_dept(p_actor) = v_wo.target_department_id OR v_wo.assignee_id = p_actor) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_wo.status <> '處理中' THEN RETURN json_build_object('ok', false, 'error', 'NOT_IN_PROGRESS'); END IF;
  IF v_wo.linked_type IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'ALREADY_LINKED'); END IF;

  SELECT name INTO v_owner FROM public.employees WHERE id = COALESCE(v_wo.assignee_id, p_actor);
  v_prio := CASE v_wo.priority WHEN 'high' THEN '高' ELSE '中' END;

  INSERT INTO public.projects (name, description, status, priority, owner, owner_id, department, organization_id, start_date)
  VALUES (COALESCE(NULLIF(btrim(p_name),''), v_wo.title),
          COALESCE(p_description, v_wo.description),
          '進行中', v_prio, v_owner, COALESCE(v_wo.assignee_id, p_actor),
          v_wo.target_department_name, v_wo.organization_id, now()::date)
  RETURNING id INTO v_proj_id;

  UPDATE public.work_orders
     SET linked_type = 'project', linked_project_id = v_proj_id, updated_at = now()
   WHERE id = p_id;
  RETURN json_build_object('ok', true, 'project_id', v_proj_id);
END $$;

-- Web / LIFF 薄殼
CREATE OR REPLACE FUNCTION public.convert_work_order_to_project(p_id int, p_name text DEFAULT NULL, p_description text DEFAULT NULL)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._wo_to_project(p_id, public.current_employee_id(), p_name, p_description);
$$;
CREATE OR REPLACE FUNCTION public.liff_convert_work_order_to_project(p_line_user_id text, p_id int, p_name text DEFAULT NULL, p_description text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  RETURN public._wo_to_project(p_id, emp.id, p_name, p_description);
END $$;
GRANT EXECUTE ON FUNCTION public.convert_work_order_to_project(int, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liff_convert_work_order_to_project(text, int, text, text) TO anon, authenticated;

-- ③b 綁流程:工作流部署精靈建好 instance 後回填綁定(流程本身用現有精靈建,這裡只 link)
CREATE OR REPLACE FUNCTION public._wo_link_workflow(p_id int, p_actor int, p_workflow_instance_id int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (_wo_actor_is_admin(p_actor) OR _wo_actor_dept(p_actor) = v_wo.target_department_id OR v_wo.assignee_id = p_actor) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_wo.status <> '處理中' THEN RETURN json_build_object('ok', false, 'error', 'NOT_IN_PROGRESS'); END IF;
  IF v_wo.linked_type IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'ALREADY_LINKED'); END IF;
  UPDATE public.work_orders
     SET linked_type = 'workflow', linked_workflow_instance_id = p_workflow_instance_id, updated_at = now()
   WHERE id = p_id;
  RETURN json_build_object('ok', true);
END $$;
CREATE OR REPLACE FUNCTION public.link_work_order_workflow(p_id int, p_workflow_instance_id int)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._wo_link_workflow(p_id, public.current_employee_id(), p_workflow_instance_id);
$$;
GRANT EXECUTE ON FUNCTION public.link_work_order_workflow(int, int) TO authenticated;

-- ④ 自動完成:專案所有任務完成 → 專案已完成 → 工單已完成
CREATE OR REPLACE FUNCTION public._trg_wo_project_autocomplete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo_id int; v_total int; v_done int;
BEGIN
  -- 只在任務剛轉為已完成 + 有掛專案時才動,其餘早退(低干擾)
  IF NEW.status <> '已完成' OR COALESCE(OLD.status,'') = '已完成' OR NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- 這專案有沒有綁「處理中」的工單?沒有就不管
  SELECT id INTO v_wo_id FROM public.work_orders
   WHERE linked_project_id = NEW.project_id AND status = '處理中' AND deleted_at IS NULL LIMIT 1;
  IF v_wo_id IS NULL THEN RETURN NEW; END IF;
  -- 專案所有(未封存)任務都完成?
  SELECT count(*), count(*) FILTER (WHERE status = '已完成')
    INTO v_total, v_done
    FROM public.tasks WHERE project_id = NEW.project_id AND archived_at IS NULL;
  IF v_total > 0 AND v_done = v_total THEN
    UPDATE public.projects SET status = '已完成', progress = 100, updated_at = now() WHERE id = NEW.project_id;
    UPDATE public.work_orders SET status = '已完成', completed_at = now(), updated_at = now() WHERE id = v_wo_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_wo_project_autocomplete ON public.tasks;
CREATE TRIGGER trg_wo_project_autocomplete
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._trg_wo_project_autocomplete();

-- ⑤ 自動完成:流程「已完成」→ 綁定工單「已完成」
CREATE OR REPLACE FUNCTION public._trg_wo_workflow_autocomplete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo_id int;
BEGIN
  IF NEW.status <> '已完成' OR COALESCE(OLD.status,'') = '已完成' THEN RETURN NEW; END IF;
  SELECT id INTO v_wo_id FROM public.work_orders
   WHERE linked_workflow_instance_id = NEW.id AND status = '處理中' AND deleted_at IS NULL LIMIT 1;
  IF v_wo_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.work_orders SET status = '已完成', completed_at = now(), updated_at = now() WHERE id = v_wo_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_wo_workflow_autocomplete ON public.workflow_instances;
CREATE TRIGGER trg_wo_workflow_autocomplete
  AFTER UPDATE OF status ON public.workflow_instances
  FOR EACH ROW EXECUTE FUNCTION public._trg_wo_workflow_autocomplete();

NOTIFY pgrst, 'reload schema';
