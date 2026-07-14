-- 工單轉專案改「建完才綁」+ 解除轉換 — 2026-07-14
-- 對齊轉流程:轉專案不再按下即建即綁,改成跳新增專案畫面、真的建了才 link_work_order_project。
-- 另加 unlink_work_order_execution 讓誤轉/想反悔的工單解除綁定(限處理中)。

-- 綁專案(核心 actor 版):比照 _wo_link_workflow
CREATE OR REPLACE FUNCTION public._wo_link_project(p_id int, p_actor int, p_project_id int)
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
     SET linked_type = 'project', linked_project_id = p_project_id, updated_at = now()
   WHERE id = p_id;
  RETURN json_build_object('ok', true);
END $$;
CREATE OR REPLACE FUNCTION public.link_work_order_project(p_id int, p_project_id int)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._wo_link_project(p_id, public.current_employee_id(), p_project_id);
$$;
GRANT EXECUTE ON FUNCTION public.link_work_order_project(int, int) TO authenticated;

-- 解除轉換(限處理中 + 已綁專案/流程):清掉綁定,工單回單純處理中,可重選
CREATE OR REPLACE FUNCTION public._wo_unlink_execution(p_id int, p_actor int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_id;
  IF v_wo.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT (_wo_actor_is_admin(p_actor) OR _wo_actor_dept(p_actor) = v_wo.target_department_id OR v_wo.assignee_id = p_actor) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED'); END IF;
  IF v_wo.status <> '處理中' OR v_wo.linked_type IS NULL THEN RETURN json_build_object('ok', false, 'error', 'BAD_STATUS'); END IF;
  UPDATE public.work_orders
     SET linked_type = NULL, linked_project_id = NULL, linked_workflow_instance_id = NULL, updated_at = now()
   WHERE id = p_id;
  RETURN json_build_object('ok', true);
END $$;
CREATE OR REPLACE FUNCTION public.unlink_work_order_execution(p_id int)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._wo_unlink_execution(p_id, public.current_employee_id());
$$;
GRANT EXECUTE ON FUNCTION public.unlink_work_order_execution(int) TO authenticated;

NOTIFY pgrst, 'reload schema';
