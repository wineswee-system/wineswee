-- 非費用申請「不綁驗收」— 核准即完成,不進核銷/驗收關 — 2026-07-27
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:非費用單(is_expense=false,如用印/意向書/業績總表)沒錢可核銷,核准(已核准)後
--   不該再被撈進「待送驗收 / 核銷挑單」逼人做一關驗收。
-- 做法(鬆耦合,驗收純靠 status 判斷,無硬 FK):
--   1. web_list_my_settle_todos — 撈驗收待辦時排除 is_expense=false
--   2. liff_list_settle_candidates — LIFF 任務挑單核銷候選排除 is_expense=false
--   3. submit_expense_settle — 後端守門:非費用單一律拒絕送核銷(即使前端漏擋也擋得住)
--   4. 資料:2 筆進行中的待核銷非費用(#317/#323)直接把驗收銷掉→退回已核准當終點
-- 前端 ExpenseRequests 驗收鈕本就有 r.is_expense !== false 擋著(row 976),不再冒鈕;
--   「未送核銷」分頁計數的顯示微調另在前端處理。
-- 舊的 33 筆已核銷非費用維持不動(歷史)。
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Web「待送驗收」待辦:排除非費用 ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.web_list_my_settle_todos()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me int := current_employee_id();
BEGIN
  IF v_me IS NULL THEN RETURN '[]'::json; END IF;
  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id',               er.id,
      'doc_type',         COALESCE(er.doc_type, 'expense'),
      'title',            er.title,
      'estimated_amount', er.estimated_amount,
      'employee',         er.employee,
      'status',           er.status,
      'settle_unit', CASE
        WHEN er.settle_store_id IS NOT NULL
          THEN (SELECT name FROM stores WHERE id = er.settle_store_id)
        WHEN er.settle_department_id IS NOT NULL
          THEN (SELECT name FROM departments WHERE id = er.settle_department_id)
        ELSE NULL END
    ) ORDER BY er.id DESC)
    FROM expense_requests er
    WHERE er.status IN ('已核准', '核銷已退回')
      AND er.deleted_at IS NULL
      AND er.is_expense IS DISTINCT FROM false          -- 非費用不進驗收
      AND (
        er.settle_assignee_id = v_me
        OR (er.settle_assignee_id IS NULL AND er.employee_id = v_me)
      )
  ), '[]'::json);
END $function$;

-- ── 2. LIFF 任務挑單核銷候選:排除非費用 ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_settle_candidates(p_line_user_id text, p_binding_id integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         AND er.is_expense IS DISTINCT FROM false        -- 非費用不進驗收
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
END $function$;

-- ── 3. 後端守門:非費用單拒絕送核銷 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_expense_settle(p_id integer, p_actual_amount numeric, p_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me       int  := public.current_employee_id();
  v_is_admin bool := public.is_admin();
  v_er       public.expense_requests;
BEGIN
  IF v_me IS NULL AND NOT v_is_admin THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT * INTO v_er FROM public.expense_requests WHERE id = p_id;
  IF v_er.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  -- 非費用單不綁驗收:核准即完成,不接受送核銷
  IF v_er.is_expense IS DISTINCT FROM true THEN
    RETURN json_build_object('ok', false, 'error', 'NON_EXPENSE_NO_SETTLE',
      'message', '非費用申請核准後即完成,不需送驗收');
  END IF;

  IF v_er.status NOT IN ('已核准', '核銷已退回') THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_SETTLEABLE', 'status', v_er.status);
  END IF;

  -- 把關:核銷負責人 / 未指派時的申請人 / admin（對齊 web_list_my_settle_todos 認定）
  IF NOT (
    v_is_admin
    OR v_er.settle_assignee_id = v_me
    OR (v_er.settle_assignee_id IS NULL AND v_er.employee_id = v_me)
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_SETTLE_OWNER');
  END IF;

  IF p_actual_amount IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'AMOUNT_REQUIRED');
  END IF;

  IF v_er.status = '核銷已退回' THEN
    -- 重送:清掉舊核銷鏈,讓 trigger 依新金額重抓
    UPDATE public.expense_requests
       SET actual_amount = p_actual_amount, notes = p_notes, status = '待核銷',
           settle_chain_id = NULL, settle_current_step = 0, settle_reject_reason = NULL,
           settled_by = NULL, settled_at = NULL
     WHERE id = p_id;
  ELSE
    UPDATE public.expense_requests
       SET actual_amount = p_actual_amount, notes = p_notes, status = '待核銷'
     WHERE id = p_id;
  END IF;

  RETURN json_build_object('ok', true);
END $function$;

-- ── 4. 兩筆進行中的待核銷非費用:直接把驗收銷掉→退回已核准當終點 ──────────────
UPDATE public.expense_requests
   SET status = '已核准',
       settle_chain_id = NULL,
       settle_current_step = 0,
       settle_reject_reason = NULL,
       settled_by = NULL,
       settled_at = NULL
 WHERE id IN (317, 323)
   AND is_expense = false
   AND status = '待核銷';

NOTIFY pgrst, 'reload schema';
