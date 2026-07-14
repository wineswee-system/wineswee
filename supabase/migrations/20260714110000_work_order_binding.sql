-- 跨部門工單當「任務綁定」型別 — 2026-07-14
-- 工單像叫貨/調撥一樣可加到任務的「加入綁定」，支援自己填/別人填。
-- 填寫=開一張工單(填目標部門)→ 綁定持續追蹤工單狀態 → 工單完成→綁定完成→任務完成。
-- 對方收到工單後可用 Phase 1「轉專案/流程」執行。

-- ① 工單回連綁定
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS linked_binding_id int REFERENCES public.task_form_bindings(id) ON DELETE SET NULL;

-- ② create_task_form_binding 允許 work_order 型別（其餘逐字保留原行為）
CREATE OR REPLACE FUNCTION public.create_task_form_binding(p_task_id integer, p_form_type text, p_form_template_id integer DEFAULT NULL::integer, p_fill_mode text DEFAULT 'self'::text, p_assignee_id integer DEFAULT NULL::integer)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_required_status TEXT;
  v_label           TEXT;
  v_id              INT;
  v_fill_mode       TEXT := CASE WHEN p_fill_mode = 'other' THEN 'other' ELSE 'self' END;
BEGIN
  IF p_form_type NOT IN (
    'expense_request', 'expense', 'form_submission', 'store_audit', 'goods_transfer',
    'expense_apply', 'expense_settle', 'goods_transfer_apply', 'goods_transfer_receipt',
    'order_request', 'order_apply', 'order_settle', 'work_order'
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_FORM_TYPE');
  END IF;

  v_required_status := CASE p_form_type
    WHEN 'expense_request' THEN '已核銷'
    WHEN 'expense'         THEN '已核銷'
    WHEN 'form_submission' THEN '已核准'
    WHEN 'store_audit'     THEN '已核准'
    WHEN 'goods_transfer'  THEN '已完成'
    WHEN 'expense_apply'          THEN '已核准'
    WHEN 'expense_settle'         THEN '已核銷'
    WHEN 'goods_transfer_apply'   THEN '待驗收'
    WHEN 'goods_transfer_receipt' THEN '已完成'
    WHEN 'order_request'  THEN '已核銷'
    WHEN 'order_apply'    THEN '已核准'
    WHEN 'order_settle'   THEN '已核銷'
    WHEN 'work_order'     THEN '已完成'
  END;

  v_label := CASE p_form_type
    WHEN 'expense_request' THEN '申請費用'
    WHEN 'expense'         THEN '費用報銷'
    WHEN 'form_submission' THEN COALESCE((SELECT name FROM form_templates WHERE id = p_form_template_id), '自訂表單')
    WHEN 'store_audit'     THEN '門市稽核'
    WHEN 'goods_transfer'  THEN '商品調撥'
    WHEN 'expense_apply'          THEN '費用-申請'
    WHEN 'expense_settle'         THEN '費用-核銷(驗收)'
    WHEN 'goods_transfer_apply'   THEN '調撥-申請'
    WHEN 'goods_transfer_receipt' THEN '調撥-入庫驗收'
    WHEN 'order_request'  THEN '叫貨申請'
    WHEN 'order_apply'    THEN '叫貨-申請'
    WHEN 'order_settle'   THEN '叫貨-驗收'
    WHEN 'work_order'     THEN '跨部門工單'
  END;

  SELECT id INTO v_id FROM task_form_bindings
   WHERE task_id = p_task_id AND form_type = p_form_type
     AND COALESCE(form_template_id, -1) = COALESCE(p_form_template_id, -1) LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN json_build_object('ok', true, 'binding_id', v_id, 'reused', true);
  END IF;

  INSERT INTO task_form_bindings (task_id, form_type, form_template_id, required_status, form_label, fill_mode, assignee_id)
  VALUES (p_task_id, p_form_type, p_form_template_id, v_required_status, v_label, v_fill_mode,
          CASE WHEN v_fill_mode = 'other' THEN p_assignee_id ELSE NULL END)
  RETURNING id INTO v_id;

  IF v_fill_mode = 'other' AND p_assignee_id IS NOT NULL THEN
    PERFORM public.assign_task_form_binding_filler(v_id, p_assignee_id);
  END IF;

  RETURN json_build_object('ok', true, 'binding_id', v_id, 'reused', false);
END $function$;

-- ③ 填綁定=開工單(核心 actor 版):填目標部門 → 建工單 + 回連綁定
CREATE OR REPLACE FUNCTION public._wo_for_binding(p_binding_id int, p_actor int, p_target_department_id int, p_priority text, p_expected_due_date date, p_assignee_id int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.task_form_bindings; v_task public.tasks; v_res json; v_wo_id int; v_prio text; v_due date;
BEGIN
  IF p_actor IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF p_target_department_id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'MISSING_FIELDS'); END IF;
  SELECT * INTO b FROM public.task_form_bindings WHERE id = p_binding_id;
  IF b.id IS NULL OR b.form_type <> 'work_order' THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF b.form_id IS NOT NULL THEN RETURN json_build_object('ok', false, 'error', 'ALREADY_FILLED'); END IF;
  SELECT * INTO v_task FROM public.tasks WHERE id = b.task_id;
  v_prio := COALESCE(NULLIF(p_priority,''), 'medium');
  v_due  := COALESCE(p_expected_due_date, v_task.due_date::date);
  v_res := public._wo_create(p_actor, p_target_department_id, COALESCE(NULLIF(v_task.title,''), '跨部門工單'),
             COALESCE(NULLIF(v_task.description,''), v_task.notes, ''), v_prio, v_due, NULL, p_assignee_id, '[]'::jsonb);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
  v_wo_id := (v_res->>'id')::int;
  UPDATE public.work_orders SET linked_binding_id = p_binding_id WHERE id = v_wo_id;
  UPDATE public.task_form_bindings SET form_id = v_wo_id, status = '簽核中' WHERE id = p_binding_id;
  RETURN json_build_object('ok', true, 'work_order_id', v_wo_id, 'binding_id', p_binding_id);
END $$;

CREATE OR REPLACE FUNCTION public.create_work_order_for_binding(p_binding_id int, p_target_department_id int, p_priority text DEFAULT NULL, p_expected_due_date date DEFAULT NULL, p_assignee_id int DEFAULT NULL)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._wo_for_binding(p_binding_id, public.current_employee_id(), p_target_department_id, p_priority, p_expected_due_date, p_assignee_id);
$$;
CREATE OR REPLACE FUNCTION public.liff_create_work_order_for_binding(p_line_user_id text, p_binding_id int, p_target_department_id int, p_priority text DEFAULT NULL, p_expected_due_date date DEFAULT NULL, p_assignee_id int DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE emp public.employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;
  RETURN public._wo_for_binding(p_binding_id, emp.id, p_target_department_id, p_priority, p_expected_due_date, p_assignee_id);
END $$;
GRANT EXECUTE ON FUNCTION public.create_work_order_for_binding(int, int, text, date, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liff_create_work_order_for_binding(text, int, int, text, date, int) TO anon, authenticated;

-- ④ 工單狀態 → 綁定狀態同步(比照 _sync_goods_transfer_bindings)
CREATE OR REPLACE FUNCTION public._sync_work_order_bindings(rec public.work_orders)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.task_form_bindings; v_new text;
BEGIN
  FOR b IN
    SELECT * FROM public.task_form_bindings
     WHERE form_type = 'work_order' AND (form_id = rec.id OR id = rec.linked_binding_id)
  LOOP
    v_new := CASE
      WHEN rec.status IN ('已完成','已結案') THEN '已完成'
      WHEN rec.status = '已退回'              THEN '已退回'
      WHEN rec.status IN ('待受理','處理中')  THEN '簽核中'
      ELSE b.status END;
    UPDATE public.task_form_bindings
       SET form_id = rec.id, status = v_new,
           completed_at = CASE WHEN v_new = '已完成' THEN now() ELSE NULL END
     WHERE id = b.id AND status IS DISTINCT FROM v_new;
    IF v_new = '已完成' THEN PERFORM public._check_task_bindings_complete(b.task_id); END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._trg_sync_work_order_to_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.linked_binding_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.task_form_bindings WHERE form_id = NEW.id AND form_type = 'work_order') THEN
    PERFORM public._sync_work_order_bindings(NEW);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sync_work_order_to_binding ON public.work_orders;
CREATE TRIGGER trg_sync_work_order_to_binding
  AFTER INSERT OR UPDATE OF status ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public._trg_sync_work_order_to_binding();

NOTIFY pgrst, 'reload schema';
