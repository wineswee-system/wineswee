-- ════════════════════════════════════════════════════════════════════════════
-- form_submissions chain advance Phase 2:
--   1. ash trigger 加 form_submissions (自動寫 approval_step_history)
--   2. web_list_my_pending_approval_ids 加 form_submissions (簽核人看到待簽)
--   3. liff_list_pending_approvals 加 form_submissions
-- ────────────────────────────────────────────────────────────────────────────
-- 對齊既有 chain 表（resignation/expense_request 等）：
--   - INSERT 申請中 + 有 chain → ash 寫 step 0 entered
--   - UPDATE current_step++ → 上 step exited + 下 step entered
--   - UPDATE status 終態 → 當前 step exited + action=approved/rejected
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 改 ash trigger function 認 form_submissions ────────────────────────
-- 1:1 重寫 20260519150000，唯一新增是 CASE 多一條 'form_submission'
-- 注意：form_submissions 的 chain_id 來自 join template，trigger 內 NEW 沒這欄位
-- → 用 SELECT approval_chain_id FROM form_templates WHERE id = NEW.template_id
CREATE OR REPLACE FUNCTION public._trg_ash_record_chain_step()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rt          text;
  v_new_json    jsonb;
  v_old_json    jsonb;
  v_step_label  text;
  v_target_type text;
  v_approver    text;
  v_approver_id int;
  v_action      text;
  v_chain_id    int;  -- ★ 新增：form_submissions 從 template 拿 chain_id
BEGIN
  v_rt := CASE TG_TABLE_NAME
    WHEN 'leave_requests'        THEN 'leave'
    WHEN 'overtime_requests'     THEN 'overtime'
    WHEN 'business_trips'        THEN 'trip'
    WHEN 'clock_corrections'     THEN 'correction'
    WHEN 'expenses'              THEN 'expense'
    WHEN 'expense_requests'      THEN 'expense_request'
    WHEN 'resignation_requests'  THEN 'resignation'
    WHEN 'leave_of_absence_requests'     THEN 'loa'
    WHEN 'personnel_transfer_requests'   THEN 'transfer'
    WHEN 'headcount_requests'    THEN 'headcount'
    WHEN 'form_submissions'      THEN 'form_submission'
    ELSE NULL
  END;
  IF v_rt IS NULL THEN RETURN NEW; END IF;

  v_new_json := to_jsonb(NEW);

  -- form_submissions 從 template 抓 chain_id (其他表 chain_id 在 NEW 內)
  IF v_rt = 'form_submission' THEN
    SELECT approval_chain_id INTO v_chain_id
      FROM form_templates WHERE id = (v_new_json->>'template_id')::int;
  ELSE
    v_chain_id := NULLIF(v_new_json->>'approval_chain_id', '')::int;
  END IF;

  -- INSERT：起手寫第一筆 entered
  IF TG_OP = 'INSERT' AND v_chain_id IS NOT NULL THEN
    SELECT label, target_type INTO v_step_label, v_target_type
      FROM approval_chain_steps
     WHERE chain_id = v_chain_id
       AND step_order = COALESCE((v_new_json->>'current_step')::int, 0)
     LIMIT 1;

    INSERT INTO approval_step_history (
      request_type, request_id, organization_id, chain_id,
      step_order, step_label, target_type, entered_at, action
    ) VALUES (
      v_rt,
      (v_new_json->>'id')::int,
      NULLIF(v_new_json->>'organization_id','')::int,
      v_chain_id,
      COALESCE((v_new_json->>'current_step')::int, 0),
      v_step_label, v_target_type,
      now(), 'submitted'
    );
    RETURN NEW;
  END IF;

  v_approver := COALESCE(v_new_json->>'approver', v_new_json->>'approved_by');

  -- 用 name 反查 emp_id
  IF v_approver IS NOT NULL AND v_approver NOT LIKE '%系統%' AND v_approver NOT LIKE '%自動%' THEN
    SELECT id INTO v_approver_id FROM employees
     WHERE name = v_approver
       AND (NULLIF(v_new_json->>'organization_id','')::int IS NULL
            OR organization_id = (v_new_json->>'organization_id')::int)
     LIMIT 1;
  END IF;

  -- form_submissions 沒「approver」字串只有 approver_id；改用 approver_id 直接抓
  IF v_rt = 'form_submission' AND v_approver_id IS NULL THEN
    v_approver_id := NULLIF(v_new_json->>'approver_id', '')::int;
    IF v_approver_id IS NOT NULL THEN
      SELECT name INTO v_approver FROM employees WHERE id = v_approver_id;
    END IF;
  END IF;

  v_old_json := to_jsonb(OLD);

  -- UPDATE OF current_step：上一關 exit + 新關 entered
  IF TG_OP = 'UPDATE'
     AND (v_new_json->>'current_step') IS DISTINCT FROM (v_old_json->>'current_step')
     AND v_chain_id IS NOT NULL THEN
    UPDATE approval_step_history
       SET exited_at = now(),
           action = CASE
             WHEN (v_new_json->>'status') IN ('已退回','已駁回') THEN 'rejected'
             ELSE 'approved'
           END,
           approver_name = COALESCE(v_approver, approver_name),
           approver_id   = COALESCE(v_approver_id, approver_id)
     WHERE request_type = v_rt
       AND request_id = (v_new_json->>'id')::int
       AND step_order = COALESCE((v_old_json->>'current_step')::int, 0)
       AND exited_at IS NULL;

    SELECT label, target_type INTO v_step_label, v_target_type
      FROM approval_chain_steps
     WHERE chain_id = v_chain_id
       AND step_order = (v_new_json->>'current_step')::int
     LIMIT 1;

    IF v_step_label IS NOT NULL THEN
      INSERT INTO approval_step_history (
        request_type, request_id, organization_id, chain_id,
        step_order, step_label, target_type, entered_at, action
      ) VALUES (
        v_rt,
        (v_new_json->>'id')::int,
        NULLIF(v_new_json->>'organization_id','')::int,
        v_chain_id,
        (v_new_json->>'current_step')::int,
        v_step_label, v_target_type,
        now(), 'pending'
      );
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE OF status：終態關 exit
  IF TG_OP = 'UPDATE'
     AND (v_new_json->>'status') IS DISTINCT FROM (v_old_json->>'status')
     AND (v_new_json->>'status') IN ('已核准','已核銷','已退回','已駁回','已拒絕') THEN
    v_action := CASE (v_new_json->>'status')
      WHEN '已核准' THEN 'approved'
      WHEN '已核銷' THEN 'approved'
      WHEN '已退回' THEN 'rejected'
      WHEN '已駁回' THEN 'rejected'
      WHEN '已拒絕' THEN 'rejected'
    END;
    UPDATE approval_step_history
       SET exited_at = now(),
           action = v_action,
           approver_name = COALESCE(v_approver, approver_name),
           approver_id   = COALESCE(v_approver_id, approver_id)
     WHERE request_type = v_rt
       AND request_id = (v_new_json->>'id')::int
       AND exited_at IS NULL;
  END IF;

  RETURN NEW;
END $$;


-- ─── 2. 掛 trigger to form_submissions ─────────────────────────────────────
DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.form_submissions;
CREATE TRIGGER trg_log_approval_step_history
  AFTER INSERT OR UPDATE ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public._trg_ash_record_chain_step();


-- ─── 3. web_list_my_pending_approval_ids 加 form_submissions ──────────────
-- 1:1 重寫 20260519010000，加一個 'form_submissions' 區段
CREATE OR REPLACE FUNCTION public.web_list_my_pending_approval_ids()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  emp employees;
  result json;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('error', 'NOT_AUTHENTICATED');
  END IF;
  SELECT * INTO emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF emp.id IS NULL THEN
    RETURN json_build_object('error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT json_build_object(
    'leave_requests', (
      SELECT COALESCE(json_agg(l.id), '[]'::json) FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id AND l.status = '待審核' AND COALESCE(l.employee_id, -1) <> emp.id
        AND ((l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)))
          OR public._has_pending_extra_for_me('leave_requests', l.id, emp.id))
    ),
    'overtime_requests', (
      SELECT COALESCE(json_agg(o.id), '[]'::json) FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核' AND COALESCE(o.employee_id, -1) <> emp.id
        AND ((o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)))
          OR public._has_pending_extra_for_me('overtime_requests', o.id, emp.id))
    ),
    'business_trips', (
      SELECT COALESCE(json_agg(t.id), '[]'::json) FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1) e_app ON true
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核' AND COALESCE(e_app.id, -1) <> emp.id
        AND ((t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))))
          OR public._has_pending_extra_for_me('business_trips', t.id, emp.id))
    ),
    'clock_corrections', (
      SELECT COALESCE(json_agg(c.id), '[]'::json) FROM public.clock_corrections c
      JOIN public.employees e_app ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核' AND e_app.id <> emp.id
        AND ((c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
          OR public._has_pending_extra_for_me('clock_corrections', c.id, emp.id))
    ),
    'expenses', (
      SELECT COALESCE(json_agg(ex.id), '[]'::json) FROM public.expenses ex
      JOIN public.employees e_app ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核' AND e_app.id <> emp.id
        AND ((ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
          OR public._has_pending_extra_for_me('expenses', ex.id, emp.id))
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(er.id), '[]'::json) FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.approval_chain_id AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '申請中' AND COALESCE(er.employee_id, -1) <> emp.id
        AND ((er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id))
          OR public._has_pending_extra_for_me('expense_requests', er.id, emp.id))
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(er.id), '[]'::json) FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.settle_chain_id AND cur_step.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '待核銷' AND COALESCE(er.employee_id, -1) <> emp.id
        AND er.settle_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'resignation_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json) FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中' AND COALESCE(r.employee_id, -1) <> emp.id
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('resignation_requests', r.id, emp.id))
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json) FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中' AND COALESCE(r.employee_id, -1) <> emp.id
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id))
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(r.id), '[]'::json) FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中' AND COALESCE(r.employee_id, -1) <> emp.id
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id))
    ),
    'headcount_requests', (
      SELECT COALESCE(json_agg(h.id), '[]'::json) FROM public.headcount_requests h
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = h.approval_chain_id AND cs.step_order = h.current_step
      WHERE h.organization_id = emp.organization_id AND h.status = '申請中' AND COALESCE(h.employee_id, -1) <> emp.id
        AND ((h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id))
          OR public._has_pending_extra_for_me('headcount_requests', h.id, emp.id))
    ),
    -- ★ 新增 (2026-05-19 phase 2) ─────────────────────────────────────
    'form_submissions', (
      SELECT COALESCE(json_agg(s.id), '[]'::json)
      FROM public.form_submissions s
      JOIN public.form_templates t ON t.id = s.template_id
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = t.approval_chain_id AND cur_step.step_order = s.current_step
      WHERE s.organization_id = emp.organization_id
        AND s.status = '申請中'
        AND COALESCE(s.applicant_id, -1) <> emp.id
        AND (
          (t.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, s.applicant_id))
          OR public._has_pending_extra_for_me('form_submissions', s.id, emp.id)
        )
    ),
    'shift_swaps', (
      SELECT COALESCE(json_agg(ss.id), '[]'::json) FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND ((ss.status = '待對方同意' AND ss.target_id = emp.id AND ss.requester_id <> emp.id)
          OR (ss.status = '待主管核准'
              AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
                   OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))
              AND ss.requester_id <> emp.id AND ss.target_id <> emp.id))
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(ofr.id), '[]'::json) FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id AND ofr.status = '待審核' AND ofr.employee <> emp.name
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(
          (SELECT id FROM employees WHERE name = ofr.employee AND organization_id = ofr.organization_id LIMIT 1)))
    ),
    'task_confirmations', (
      SELECT COALESCE(json_agg(tc.id), '[]'::json) FROM public.task_confirmations tc
      WHERE tc.approver = emp.name AND tc.status = 'pending'
    )
  ) INTO result;
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION public.web_list_my_pending_approval_ids() TO authenticated;


-- ─── 4. liff_list_pending_approvals 加 form_submissions ───────────────────
-- 同樣 1:1 重寫 (簡化版只貼新增區段，其他全沿用上一版)
CREATE OR REPLACE FUNCTION public.liff_list_pending_approvals(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  result json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object(
      'leaves','[]'::json,'overtimes','[]'::json,'trips','[]'::json,
      'expenses','[]'::json,'corrections','[]'::json,'expense_requests','[]'::json,
      'expense_settles','[]'::json,
      'resignation_requests','[]'::json,'leave_of_absence_requests','[]'::json,
      'personnel_transfer_requests','[]'::json,'headcount_requests','[]'::json,
      'form_submissions','[]'::json,
      'task_confirmations','[]'::json,
      'shift_swaps_for_peer','[]'::json,'shift_swaps_for_manager','[]'::json,
      'off_requests','[]'::json,
      'can', json_build_object('hr', false, 'finance', false)
    );
  END IF;

  SELECT json_build_object(
    'leaves', (
      SELECT COALESCE(json_agg(row_to_json(l.*) ORDER BY l.created_at DESC), '[]'::json) FROM public.leave_requests l
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = l.approval_chain_id AND cs.step_order = l.current_step
      WHERE l.organization_id = emp.organization_id AND l.status = '待審核' AND COALESCE(l.employee_id, -1) <> emp.id
        AND ((l.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, l.employee_id))
          OR (l.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id)))
          OR public._has_pending_extra_for_me('leave_requests', l.id, emp.id))
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json) FROM public.overtime_requests o
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = o.approval_chain_id AND cs.step_order = o.current_step
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核' AND COALESCE(o.employee_id, -1) <> emp.id
        AND ((o.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, o.employee_id))
          OR (o.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id)))
          OR public._has_pending_extra_for_me('overtime_requests', o.id, emp.id))
    ),
    'trips', (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json) FROM public.business_trips t
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = t.approval_chain_id AND cs.step_order = t.current_step
      LEFT JOIN LATERAL (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1) e_app ON true
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核' AND COALESCE(e_app.id, -1) <> emp.id
        AND ((t.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (t.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(COALESCE(e_app.id, -1))))
          OR public._has_pending_extra_for_me('business_trips', t.id, emp.id))
    ),
    'corrections', (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json) FROM public.clock_corrections c
      JOIN public.employees e_app ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = c.approval_chain_id AND cs.step_order = c.current_step
      WHERE c.status = '待審核' AND e_app.id <> emp.id
        AND ((c.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (c.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
          OR public._has_pending_extra_for_me('clock_corrections', c.id, emp.id))
    ),
    'expenses', (
      SELECT COALESCE(json_agg(row_to_json(ex.*) ORDER BY ex.created_at DESC), '[]'::json) FROM public.expenses ex
      JOIN public.employees e_app ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = ex.approval_chain_id AND cs.step_order = ex.current_step
      WHERE ex.status = '待審核' AND e_app.id <> emp.id
        AND ((ex.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, e_app.id))
          OR (ex.approval_chain_id IS NULL AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id)))
          OR public._has_pending_extra_for_me('expenses', ex.id, emp.id))
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', er.id, 'employee', er.employee, 'department', er.department, 'title', er.title,
        'description', er.description, 'estimated_amount', er.estimated_amount,
        'account_code', er.account_code, 'account_name', er.account_name,
        'store', er.store, 'status', er.status, 'created_at', er.created_at,
        'reject_reason', er.reject_reason,
        'approval_chain_id', er.approval_chain_id, 'current_step', er.current_step,
        'chain_name', ac.name,
        'chain_total_steps', (SELECT COUNT(*) FROM approval_chain_steps WHERE chain_id = er.approval_chain_id),
        'current_step_label', cur_step.label,
        'current_step_target', cur_step.role_name
      ) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chains ac ON ac.id = er.approval_chain_id
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.approval_chain_id AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '申請中' AND COALESCE(er.employee_id, -1) <> emp.id
        AND ((er.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id))
          OR public._has_pending_extra_for_me('expense_requests', er.id, emp.id))
    ),
    'expense_settles', (
      SELECT COALESCE(json_agg(row_to_json(er.*) ORDER BY er.created_at DESC), '[]'::json) FROM public.expense_requests er
      LEFT JOIN public.approval_chain_steps cur_step ON cur_step.chain_id = er.settle_chain_id AND cur_step.step_order = er.settle_current_step
      WHERE er.organization_id = emp.organization_id AND er.status = '待核銷' AND COALESCE(er.employee_id, -1) <> emp.id
        AND er.settle_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id, er.employee_id)
    ),
    'resignation_requests', (
      SELECT COALESCE(json_agg(row_to_json(r.*) ORDER BY r.created_at DESC), '[]'::json) FROM public.resignation_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中' AND COALESCE(r.employee_id, -1) <> emp.id
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('resignation_requests', r.id, emp.id))
    ),
    'leave_of_absence_requests', (
      SELECT COALESCE(json_agg(row_to_json(r.*) ORDER BY r.created_at DESC), '[]'::json) FROM public.leave_of_absence_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中' AND COALESCE(r.employee_id, -1) <> emp.id
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('leave_of_absence_requests', r.id, emp.id))
    ),
    'personnel_transfer_requests', (
      SELECT COALESCE(json_agg(row_to_json(r.*) ORDER BY r.created_at DESC), '[]'::json) FROM public.personnel_transfer_requests r
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = r.approval_chain_id AND cs.step_order = r.current_step
      WHERE r.organization_id = emp.organization_id AND r.status = '申請中' AND COALESCE(r.employee_id, -1) <> emp.id
        AND ((r.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, r.employee_id))
          OR public._has_pending_extra_for_me('personnel_transfer_requests', r.id, emp.id))
    ),
    'headcount_requests', (
      SELECT COALESCE(json_agg(row_to_json(h.*) ORDER BY h.created_at DESC), '[]'::json) FROM public.headcount_requests h
      LEFT JOIN public.approval_chain_steps cs ON cs.chain_id = h.approval_chain_id AND cs.step_order = h.current_step
      WHERE h.organization_id = emp.organization_id AND h.status = '申請中' AND COALESCE(h.employee_id, -1) <> emp.id
        AND ((h.approval_chain_id IS NOT NULL AND cs.id IS NOT NULL AND public._employee_matches_chain_step(emp.id, cs.id, h.employee_id))
          OR public._has_pending_extra_for_me('headcount_requests', h.id, emp.id))
    ),
    -- ★ 新增 (2026-05-19 phase 2)
    'form_submissions', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', s.id, 'template_id', s.template_id, 'template_name', t.name,
        'applicant_id', s.applicant_id, 'applicant_name', e_app.name,
        'data', s.data, 'status', s.status, 'created_at', s.created_at,
        'current_step', s.current_step,
        'chain_id', t.approval_chain_id,
        'current_step_label', cur_step.label
      ) ORDER BY s.created_at DESC), '[]'::json)
      FROM public.form_submissions s
      JOIN public.form_templates t ON t.id = s.template_id
      LEFT JOIN public.employees e_app ON e_app.id = s.applicant_id
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = t.approval_chain_id AND cur_step.step_order = s.current_step
      WHERE s.organization_id = emp.organization_id
        AND s.status = '申請中'
        AND COALESCE(s.applicant_id, -1) <> emp.id
        AND (
          (t.approval_chain_id IS NOT NULL AND cur_step.id IS NOT NULL
            AND public._employee_matches_chain_step(emp.id, cur_step.id, s.applicant_id))
          OR public._has_pending_extra_for_me('form_submissions', s.id, emp.id)
        )
    ),
    'task_confirmations', '[]'::json,
    'shift_swaps_for_peer', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json) FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待對方同意'
        AND ss.target_id = emp.id AND ss.requester_id <> emp.id
    ),
    'shift_swaps_for_manager', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json) FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id AND ss.status = '待主管核准'
        AND ss.requester_id <> emp.id AND ss.target_id <> emp.id
        AND (EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
             OR public.liff_employee_has_permission(emp.id, 'schedule.approve'))
    ),
    'off_requests', (
      SELECT COALESCE(json_agg(row_to_json(ofr.*) ORDER BY ofr.created_at DESC), '[]'::json) FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id AND ofr.status = '待審核'
        AND COALESCE(ofr.employee_id, -1) <> emp.id
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(ofr.employee_id))
    ),
    'can', json_build_object(
      'hr', public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', (public.liff_employee_has_permission(emp.id, 'expense.approve') OR public.liff_employee_has_permission(emp.id, 'expense.settle'))
    )
  ) INTO result;
  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION public.liff_list_pending_approvals(text) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
