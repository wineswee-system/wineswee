-- ════════════════════════════════════════════════════════════════════════════
-- LIFF 核銷段挑單：列出可核銷的費用申請單 + 選定(綁 form_id)
-- 2026-06-24
--
-- 對齊電腦版 SettlePickerModal：核銷段(expense_settle)拆在不同步驟/一流程多組時，
-- 無法自動配對 → 由人挑要驗收哪張。LIFF anon 不能直接查表(RLS)，走 SECURITY DEFINER RPC。
-- ════════════════════════════════════════════════════════════════════════════

-- 列候選單：同流程(workflow_instance)待驗收、未被其他核銷段認領的費用申請單
CREATE OR REPLACE FUNCTION public.liff_list_settle_candidates(p_line_user_id text, p_binding_id int)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_binding  task_form_bindings;
  v_task     tasks;
  v_inst     int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_binding FROM task_form_bindings WHERE id = p_binding_id;
  IF v_binding.id IS NULL OR v_binding.form_type <> 'expense_settle' THEN
    RETURN json_build_object('ok', false, 'error', 'BINDING_INVALID');
  END IF;

  SELECT * INTO v_task FROM tasks WHERE id = v_binding.task_id;
  IF NOT (v_task.assignee_id = emp.id OR v_binding.assignee_id = emp.id) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  v_inst := v_task.workflow_instance_id;

  RETURN json_build_object('ok', true, 'candidates', COALESCE((
    SELECT json_agg(row_to_json(c)) FROM (
      SELECT er.id, er.title, er.employee, er.estimated_amount, er.currency, er.status
        FROM expense_requests er
       WHERE er.deleted_at IS NULL
         AND er.status IN ('已核准', '待核銷', '核銷已退回')
         AND NOT EXISTS (
           SELECT 1 FROM task_form_bindings s
            WHERE s.form_type = 'expense_settle' AND s.form_id = er.id AND s.id <> p_binding_id
         )
         AND (
           v_inst IS NULL
           OR EXISTS (
             SELECT 1 FROM task_form_bindings ab JOIN tasks at ON at.id = ab.task_id
              WHERE ab.form_type IN ('expense_request', 'expense_apply')
                AND ab.form_id = er.id
                AND at.workflow_instance_id = v_inst
           )
         )
       ORDER BY er.created_at DESC
       LIMIT 50
    ) c
  ), '[]'::json));
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_settle_candidates(text, int) TO anon, authenticated;

-- 選定：把核銷段 binding 綁到選定的費用申請單(form_id)
CREATE OR REPLACE FUNCTION public.liff_pick_settle_request(p_line_user_id text, p_binding_id int, p_request_id int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_binding  task_form_bindings;
  v_task     tasks;
  v_req      expense_requests;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_binding FROM task_form_bindings WHERE id = p_binding_id;
  IF v_binding.id IS NULL OR v_binding.form_type <> 'expense_settle' THEN
    RETURN json_build_object('ok', false, 'error', 'BINDING_INVALID');
  END IF;

  SELECT * INTO v_task FROM tasks WHERE id = v_binding.task_id;
  IF NOT (v_task.assignee_id = emp.id OR v_binding.assignee_id = emp.id) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = p_request_id AND deleted_at IS NULL;
  IF v_req.id IS NULL OR v_req.status NOT IN ('已核准', '待核銷', '核銷已退回') THEN
    RETURN json_build_object('ok', false, 'error', 'REQUEST_NOT_SETTLEABLE');
  END IF;
  IF EXISTS (SELECT 1 FROM task_form_bindings s WHERE s.form_type = 'expense_settle' AND s.form_id = p_request_id AND s.id <> p_binding_id) THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_CLAIMED');
  END IF;

  UPDATE task_form_bindings SET form_id = p_request_id WHERE id = p_binding_id;
  RETURN json_build_object('ok', true, 'request_id', p_request_id);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_pick_settle_request(text, int, int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
