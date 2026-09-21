-- ============================================================
-- 簽核中心整併 + 流程封存功能 (5 個問題的 DB 部分)
--
-- 1. workflow_instances.archived_at — 手動封存欄位
-- 2. liff_list_pending_approvals 加 task_confirmations 區段
-- 3. liff_approve_request 加 'task_confirmation' type 支援
-- 4. 新 RPC liff_list_my_submissions — 我提交的東西進度查詢
-- 5. 新 RPC liff_complete_task_v2 — 任務完成處理（有 confirmation 變待確認、否則直接完成）
-- 6. 升級 trg_sync_task_confirmation_status — 全 approve 後 task.status='已完成'
-- ============================================================


-- ═══ 1. workflow_instances.archived_at ═══
ALTER TABLE public.workflow_instances
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_wf_inst_archived
  ON public.workflow_instances(archived_at) WHERE archived_at IS NOT NULL;


-- ═══ 2 + 3. 擴充 liff_list_pending_approvals + liff_approve_request ═══
CREATE OR REPLACE FUNCTION public.liff_list_pending_approvals(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  can_hr   boolean;
  can_fin  boolean;
  result   json;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object(
      'leaves','[]'::json,'overtimes','[]'::json,'trips','[]'::json,
      'expenses','[]'::json,'corrections','[]'::json,'expense_requests','[]'::json,
      'task_confirmations','[]'::json,
      'can', json_build_object('hr', false, 'finance', false)
    );
  END IF;

  can_hr  := public.liff_employee_has_permission(emp.id, 'leave.approve');
  can_fin := public.liff_employee_has_permission(emp.id, 'finance.edit');

  SELECT json_build_object(
    'leaves', CASE WHEN can_hr THEN (
      SELECT COALESCE(json_agg(row_to_json(l.*) ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      WHERE l.organization_id = emp.organization_id AND l.status = '待審核'
    ) ELSE '[]'::json END,
    'overtimes', CASE WHEN can_hr THEN (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      WHERE o.organization_id = emp.organization_id AND o.status = '待審核'
    ) ELSE '[]'::json END,
    'trips', CASE WHEN can_hr THEN (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      WHERE t.organization_id = emp.organization_id AND t.status = '待審核'
    ) ELSE '[]'::json END,
    'expenses', CASE WHEN can_fin THEN (
      SELECT COALESCE(json_agg(row_to_json(e.*) ORDER BY e.created_at DESC), '[]'::json)
      FROM public.expenses e
      WHERE e.status = '待審核'
        AND EXISTS (SELECT 1 FROM public.employees e2 WHERE e2.name = e.employee AND e2.organization_id = emp.organization_id)
    ) ELSE '[]'::json END,
    'corrections', CASE WHEN can_hr THEN (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      WHERE c.status = '待審核'
        AND EXISTS (SELECT 1 FROM public.employees e2 WHERE e2.name = c.employee AND e2.organization_id = emp.organization_id)
    ) ELSE '[]'::json END,
    'expense_requests', CASE WHEN can_fin THEN (
      SELECT COALESCE(json_agg(json_build_object(
        'id', er.id, 'employee', er.employee, 'department', er.department,
        'title', er.title, 'description', er.description,
        'estimated_amount', er.estimated_amount,
        'account_code', er.account_code, 'account_name', er.account_name,
        'store', er.store, 'status', er.status,
        'created_at', er.created_at
      ) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      WHERE er.organization_id = emp.organization_id AND er.status = '申請中'
    ) ELSE '[]'::json END,
    -- ★ 新增：task_confirmations 等我審的任務確認
    'task_confirmations', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',                  tc.id,
        'task_id',             t.id,
        'task_title',          t.title,
        'task_status',         t.status,
        'task_assignee',       t.assignee,
        'task_store',          t.store,
        'workflow_instance_id', t.workflow_instance_id,
        'workflow_name',       wi.template_name,
        'priority',            t.priority,
        'created_at',          tc.created_at
      ) ORDER BY tc.created_at DESC), '[]'::json)
      FROM public.task_confirmations tc
      JOIN public.tasks t ON t.id = tc.task_id
      LEFT JOIN public.workflow_instances wi ON wi.id = t.workflow_instance_id
      WHERE tc.approver = emp.name
        AND tc.status = 'pending'
        AND (tc.organization_id IS NULL OR tc.organization_id = emp.organization_id)
        -- 只顯示「執行人已標記完成、等待審核」的：task.status='待確認' 或 已完成 (有 confirmation 但執行人已點完成)
        AND (t.status IN ('待確認', '已完成') OR t.confirmation_status IS NULL)
    ),
    'can', json_build_object('hr', can_hr, 'finance', can_fin)
  ) INTO result;

  RETURN result;
END $$;


-- ═══ liff_approve_request 加 task_confirmation 支援 ═══
CREATE OR REPLACE FUNCTION public.liff_approve_request(
  p_line_user_id text,
  p_type         text,
  p_id           int,
  p_action       text,
  p_reason       text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp         employees;
  perm_code   text;
  new_status  text;
  reject_val  text;
  n           int;
  correction  record;
  existing_att record;
  new_in      time;
  new_out     time;
  v_tc_status text;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  -- ★ task_confirmation 走獨立分支（不用 perm_code 守門，靠 task_confirmations.approver=emp.name 即可）
  IF p_type = 'task_confirmation' THEN
    v_tc_status := CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END;
    UPDATE task_confirmations
       SET status = v_tc_status,
           notes = CASE WHEN p_action = 'reject' THEN btrim(p_reason) ELSE notes END,
           responded_at = NOW()
     WHERE id = p_id
       AND approver = emp.name
       AND status = 'pending';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;
    RETURN json_build_object('ok', true, 'status', v_tc_status);
  END IF;

  CASE p_type
    WHEN 'leave'            THEN perm_code := 'leave.approve';
                                 new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已拒絕' END;
    WHEN 'overtime'         THEN perm_code := 'leave.approve';
                                 new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已拒絕' END;
    WHEN 'trip'             THEN perm_code := 'leave.approve';
                                 new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已駁回' END;
    WHEN 'expense'          THEN perm_code := 'finance.edit';
                                 new_status := CASE p_action WHEN 'approve' THEN '已核銷' ELSE '已駁回' END;
    WHEN 'correction'       THEN perm_code := 'leave.approve';
                                 new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已拒絕' END;
    WHEN 'expense_request'  THEN perm_code := 'finance.edit';
                                 new_status := CASE p_action WHEN 'approve' THEN '已核准' ELSE '已駁回' END;
    ELSE
      RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
  END CASE;

  IF NOT public.liff_employee_has_permission(emp.id, perm_code) THEN
    RETURN json_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  reject_val := CASE WHEN p_action = 'reject' THEN btrim(p_reason) ELSE NULL END;

  IF p_type = 'leave' THEN
    UPDATE public.leave_requests SET status = new_status, approver = emp.name, reject_reason = reject_val
     WHERE id = p_id AND status = '待審核' AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF p_type = 'overtime' THEN
    UPDATE public.overtime_requests SET status = new_status, approver = emp.name, reject_reason = reject_val
     WHERE id = p_id AND status = '待審核' AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF p_type = 'trip' THEN
    UPDATE public.business_trips SET status = new_status, approver = emp.name, reject_reason = reject_val
     WHERE id = p_id AND status = '待審核' AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF p_type = 'expense' THEN
    UPDATE public.expenses SET status = new_status, approver = emp.name, reject_reason = reject_val
     WHERE id = p_id AND status = '待審核'
       AND EXISTS (SELECT 1 FROM public.employees e2 WHERE e2.name = public.expenses.employee AND e2.organization_id = emp.organization_id);
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF p_type = 'correction' THEN
    SELECT c.* INTO correction FROM public.clock_corrections c
     WHERE c.id = p_id AND c.status = '待審核'
       AND EXISTS (SELECT 1 FROM public.employees e2 WHERE e2.name = c.employee AND e2.organization_id = emp.organization_id);
    IF NOT FOUND THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED'); END IF;
    UPDATE public.clock_corrections SET status = new_status, approver = emp.name, reject_reason = reject_val
     WHERE id = p_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF p_action = 'approve' AND correction.correction_time IS NOT NULL THEN
      new_in  := CASE WHEN correction.type = '上班打卡' THEN correction.correction_time END;
      new_out := CASE WHEN correction.type = '下班打卡' THEN correction.correction_time END;
      SELECT * INTO existing_att FROM public.attendance_records WHERE employee = correction.employee AND date = correction.date LIMIT 1;
      IF FOUND THEN
        UPDATE public.attendance_records SET clock_in = COALESCE(new_in, clock_in), clock_out = COALESCE(new_out, clock_out) WHERE id = existing_att.id;
      ELSE
        INSERT INTO public.attendance_records (employee, date, clock_in, clock_out, status) VALUES (correction.employee, correction.date, new_in, new_out, '補登');
      END IF;
    END IF;
  ELSIF p_type = 'expense_request' THEN
    UPDATE public.expense_requests
       SET status = new_status, approved_by = emp.name,
           approved_at = CASE WHEN p_action = 'approve' THEN now() ELSE NULL END,
           reject_reason = reject_val
     WHERE id = p_id AND status = '申請中' AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;

  IF n = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
  END IF;
  RETURN json_build_object('ok', true, 'status', new_status);
END $$;


-- ═══ 4. liff_list_my_submissions — 我提交的東西進度 ═══
CREATE OR REPLACE FUNCTION public.liff_list_my_submissions(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object(
      'leaves','[]'::json,'overtimes','[]'::json,'trips','[]'::json,
      'expenses','[]'::json,'corrections','[]'::json,'expense_requests','[]'::json
    );
  END IF;

  RETURN json_build_object(
    'leaves', (
      SELECT COALESCE(json_agg(row_to_json(l.*) ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      WHERE (l.employee_id = emp.id OR l.employee = emp.name)
      LIMIT 50
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      WHERE (o.employee_id = emp.id OR o.employee = emp.name)
      LIMIT 50
    ),
    'trips', (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      WHERE t.employee = emp.name
      LIMIT 50
    ),
    'expenses', (
      SELECT COALESCE(json_agg(row_to_json(e.*) ORDER BY e.created_at DESC), '[]'::json)
      FROM public.expenses e
      WHERE e.employee = emp.name
      LIMIT 50
    ),
    'corrections', (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      WHERE c.employee = emp.name
      LIMIT 50
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(row_to_json(er.*) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      WHERE er.employee = emp.name
      LIMIT 50
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_submissions(text) TO anon, authenticated;


-- ═══ 5. liff_complete_task_v2 — 完成任務的智能流程 ═══
-- 若任務有 task_confirmations → 設 status='待確認' + 通知 confirmer
-- 否則 → 直接 status='已完成'
-- 同時釋出可推進的下一步（task_dependencies 滿足時）
CREATE OR REPLACE FUNCTION public.liff_complete_task_v2(
  p_line_user_id text,
  p_task_id      int
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  task_row      tasks;
  has_pending   boolean;
  new_status    text;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO task_row FROM public.tasks
   WHERE id = p_task_id AND assignee_id = emp.id;
  IF task_row.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_NOT_ASSIGNED');
  END IF;

  -- 檢查是否有未回應的 confirmations
  SELECT EXISTS (
    SELECT 1 FROM task_confirmations
    WHERE task_id = p_task_id AND status = 'pending'
  ) INTO has_pending;

  -- 有確認待回應 → 待確認；沒有 → 直接完成
  new_status := CASE WHEN has_pending THEN '待確認' ELSE '已完成' END;

  UPDATE tasks SET
    status       = new_status,
    completed_at = CASE WHEN new_status = '已完成' THEN NOW() ELSE NULL END
  WHERE id = p_task_id;

  RETURN json_build_object(
    'ok', true,
    'task_id', p_task_id,
    'status', new_status,
    'has_pending_confirmations', has_pending
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_complete_task_v2(text, int) TO anon, authenticated;


-- ═══ 6. 升級 trigger：全部 confirmation approve 後 task.status='已完成' ═══
CREATE OR REPLACE FUNCTION public.trg_sync_task_confirmation_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total      INT;
  v_done       INT;
  v_rejected   INT;
  v_new_cstatus TEXT;
  v_task_status TEXT;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status IN ('approved','rejected')),
         COUNT(*) FILTER (WHERE status = 'rejected')
    INTO v_total, v_done, v_rejected
    FROM task_confirmations
   WHERE task_id = NEW.task_id;

  IF v_total = 0 OR v_done < v_total THEN RETURN NEW; END IF;

  -- 全部回應 → 寫 task.confirmation_status；同時若 task 在「待確認」狀態 → 推進到完成 / 退回
  v_new_cstatus := CASE WHEN v_rejected > 0 THEN 'rejected' ELSE 'approved' END;
  v_task_status := CASE WHEN v_rejected > 0 THEN '已退回' ELSE '已完成' END;

  UPDATE tasks SET
    confirmation_status       = v_new_cstatus,
    confirmation_responded_at = NOW(),
    -- ★ 只有原本處於「待確認」的任務才會被推進，避免影響其他狀態
    status        = CASE WHEN status = '待確認' THEN v_task_status ELSE status END,
    completed_at  = CASE WHEN status = '待確認' AND v_new_cstatus = 'approved' THEN NOW() ELSE completed_at END
  WHERE id = NEW.task_id;

  RETURN NEW;
END $$;
