-- ════════════════════════════════════════════════════════════
-- 希望休（off_requests）簽核流程
-- ────────────────────────────────────────────────────────────
-- 員工提交希望休 → 店長核准/駁回 → 通過後才會被排班演算法視為偏好
-- 既有資料視為「已核准」（向後相容）
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── Section 1. Schema additions ────────────────────────

ALTER TABLE public.off_requests
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS approver_id INT REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approver_name TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS store TEXT;

-- 既有資料視為已核准（向後相容）
UPDATE public.off_requests SET status = '已核准' WHERE status IS NULL;

-- 新單預設 待審核
ALTER TABLE public.off_requests ALTER COLUMN status SET DEFAULT '待審核';
ALTER TABLE public.off_requests ALTER COLUMN status SET NOT NULL;

-- 補 organization_id + store
UPDATE public.off_requests o SET organization_id = e.organization_id, store = COALESCE(o.store, e.store)
  FROM public.employees e
 WHERE o.organization_id IS NULL AND (o.employee_id = e.id OR o.employee = e.name);

CREATE INDEX IF NOT EXISTS idx_off_req_org_status
  ON public.off_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_off_req_pending
  ON public.off_requests(organization_id) WHERE status = '待審核';


-- ── Section 2. RPC: 員工提交希望休（覆蓋舊版以加 status） ──
-- 舊版 RETURNS json，要改 jsonb 必須先 DROP

DROP FUNCTION IF EXISTS public.liff_insert_off_request(text, date, text);
CREATE OR REPLACE FUNCTION public.liff_insert_off_request(
  p_line_user_id text,
  p_date         date,
  p_reason       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  v_supervisor  INT;
  v_status      TEXT := '待審核';
  new_id        INT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PAST_DATE');
  END IF;

  -- 同日重複 → 不處理（client 應 toggle 而不是重送）
  IF EXISTS (SELECT 1 FROM public.off_requests WHERE employee_id = emp.id AND date = p_date) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DUPLICATE');
  END IF;

  -- 申請人是組織頂端 → 自動核准
  v_supervisor := public._resolve_single_approver(emp.id);
  IF v_supervisor IS NULL AND NOT public._is_store_manager(emp.id) THEN
    v_status := '已核准';
  END IF;

  INSERT INTO public.off_requests (
    employee, employee_id, date, reason, status, organization_id, store
  )
  VALUES (
    emp.name, emp.id, p_date, p_reason, v_status, emp.organization_id, emp.store
  )
  RETURNING id INTO new_id;

  RETURN jsonb_build_object(
    'id', new_id,
    'status', v_status,
    'auto_approved', v_status = '已核准'
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_insert_off_request(text, date, text) TO authenticated, anon;


-- ── Section 3. RPC: 員工取消（只能取消自己的待審/已駁回） ──
-- 已核准的不能直接刪（需主管才能改），保護排班一致性
-- 舊版 RETURNS int，要改 jsonb 必須先 DROP

DROP FUNCTION IF EXISTS public.liff_delete_off_request(text, date);
CREATE OR REPLACE FUNCTION public.liff_delete_off_request(
  p_line_user_id text,
  p_date         date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp     employees;
  v_req   record;
  n       int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_req FROM public.off_requests
   WHERE employee_id = emp.id AND date = p_date;

  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  -- 已核准 → 不能直接刪除（要走主管撤銷流程，目前未實作 → 保守拒絕）
  IF v_req.status = '已核准' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_APPROVED_CANNOT_DELETE');
  END IF;

  DELETE FROM public.off_requests WHERE id = v_req.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', n > 0);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_delete_off_request(text, date) TO authenticated, anon;


-- ── Section 4. RPC: 主管 核准/駁回 ──────────────────────

DROP FUNCTION IF EXISTS public.liff_approve_off_request(text, int, text, text);
CREATE OR REPLACE FUNCTION public.liff_approve_off_request(
  p_line_user_id text,
  p_id           int,
  p_action       text,         -- 'approve' / 'reject'
  p_reason       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_req      record;
  v_eligible BOOLEAN;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_req FROM public.off_requests WHERE id = p_id;
  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  IF v_req.status <> '待審核' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  IF v_req.organization_id IS DISTINCT FROM emp.organization_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORG_MISMATCH');
  END IF;

  -- 簽核者：該員工的 HR-style 簽核者（店長 / supervisor / dept manager）
  SELECT EXISTS (
    SELECT 1 FROM public._resolve_hr_approver_ids(v_req.employee_id)
    WHERE _resolve_hr_approver_ids = emp.id
  ) INTO v_eligible;

  IF NOT v_eligible THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.off_requests SET
      status = '已核准',
      approver_id = emp.id,
      approver_name = emp.name,
      approved_at = now()
     WHERE id = p_id;

    RETURN jsonb_build_object(
      'ok', true, 'event', 'approved',
      'applicant_emp_id', v_req.employee_id,
      'date', v_req.date
    );
  ELSIF p_action = 'reject' THEN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
    END IF;

    UPDATE public.off_requests SET
      status = '已駁回',
      approver_id = emp.id,
      approver_name = emp.name,
      approved_at = now(),
      reject_reason = btrim(p_reason)
     WHERE id = p_id;

    RETURN jsonb_build_object(
      'ok', true, 'event', 'rejected',
      'applicant_emp_id', v_req.employee_id,
      'date', v_req.date,
      'reason', btrim(p_reason)
    );
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_approve_off_request(text, int, text, text) TO authenticated, anon;


-- ── Section 5. liff_list_pending_approvals 加 off_requests ──

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
      'task_confirmations','[]'::json,
      'shift_swaps_for_peer','[]'::json,'shift_swaps_for_manager','[]'::json,
      'off_requests','[]'::json,
      'can', json_build_object('hr', false, 'finance', false)
    );
  END IF;

  SELECT json_build_object(
    'leaves', (
      SELECT COALESCE(json_agg(row_to_json(l.*) ORDER BY l.created_at DESC), '[]'::json)
      FROM public.leave_requests l
      WHERE l.organization_id = emp.organization_id
        AND l.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(l.employee_id))
    ),
    'overtimes', (
      SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.created_at DESC), '[]'::json)
      FROM public.overtime_requests o
      WHERE o.organization_id = emp.organization_id
        AND o.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(o.employee_id))
    ),
    'trips', (
      SELECT COALESCE(json_agg(row_to_json(t.*) ORDER BY t.created_at DESC), '[]'::json)
      FROM public.business_trips t
      WHERE t.organization_id = emp.organization_id
        AND t.status = '待審核'
        AND emp.id IN (
          SELECT public._resolve_hr_approver_ids(
            COALESCE(
              (SELECT id FROM employees WHERE name = t.employee AND organization_id = t.organization_id LIMIT 1),
              -1
            )
          )
        )
    ),
    'corrections', (
      SELECT COALESCE(json_agg(row_to_json(c.*) ORDER BY c.created_at DESC), '[]'::json)
      FROM public.clock_corrections c
      JOIN public.employees e_app
        ON e_app.name = c.employee AND e_app.organization_id = emp.organization_id
      WHERE c.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id))
    ),
    'expenses', (
      SELECT COALESCE(json_agg(row_to_json(ex.*) ORDER BY ex.created_at DESC), '[]'::json)
      FROM public.expenses ex
      JOIN public.employees e_app
        ON e_app.name = ex.employee AND e_app.organization_id = emp.organization_id
      WHERE ex.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(e_app.id))
    ),
    'expense_requests', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', er.id, 'employee', er.employee, 'department', er.department,
        'title', er.title, 'description', er.description,
        'estimated_amount', er.estimated_amount,
        'account_code', er.account_code, 'account_name', er.account_name,
        'store', er.store, 'status', er.status,
        'created_at', er.created_at,
        'reject_reason', er.reject_reason,
        'approval_chain_id', er.approval_chain_id,
        'current_step', er.current_step,
        'chain_name', ac.name,
        'chain_total_steps', (SELECT COUNT(*) FROM approval_chain_steps WHERE chain_id = er.approval_chain_id),
        'current_step_label', cur_step.label,
        'current_step_target', cur_step.role_name
      ) ORDER BY er.created_at DESC), '[]'::json)
      FROM public.expense_requests er
      LEFT JOIN public.approval_chains ac ON ac.id = er.approval_chain_id
      LEFT JOIN public.approval_chain_steps cur_step
        ON cur_step.chain_id = er.approval_chain_id
       AND cur_step.step_order = er.current_step
      WHERE er.organization_id = emp.organization_id
        AND er.status = '申請中'
        AND er.approval_chain_id IS NOT NULL
        AND cur_step.id IS NOT NULL
        AND public._employee_matches_chain_step(emp.id, cur_step.id)
    ),
    'task_confirmations', '[]'::json,
    'shift_swaps_for_peer', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND ss.status = '待對方同意'
        AND ss.target_id = emp.id
    ),
    'shift_swaps_for_manager', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND ss.status = '待主管核准'
        AND (
          EXISTS (SELECT 1 FROM stores WHERE id = ss.store_id AND manager_id = emp.id)
          OR public.liff_employee_has_permission(emp.id, 'schedule.approve')
        )
    ),
    -- 希望休：HR-style 簽核者（店長/直屬主管）
    'off_requests', (
      SELECT COALESCE(json_agg(row_to_json(ofr.*) ORDER BY ofr.created_at DESC), '[]'::json)
      FROM public.off_requests ofr
      WHERE ofr.organization_id = emp.organization_id
        AND ofr.status = '待審核'
        AND emp.id IN (SELECT public._resolve_hr_approver_ids(ofr.employee_id))
    ),
    'can', json_build_object(
      'hr', public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', public.liff_employee_has_permission(emp.id, 'finance.edit')
    )
  ) INTO result;

  RETURN result;
END $$;


-- ── Section 6. RPC: 員工列我的希望休（含狀態） ──────────
-- 舊版同名 (RETURNS json)，新版回傳結構不同（多 status 等欄位）→ 為求穩妥也 DROP

DROP FUNCTION IF EXISTS public.liff_list_off_requests(text, date, date);
CREATE OR REPLACE FUNCTION public.liff_list_off_requests(
  p_line_user_id text,
  p_from         date DEFAULT NULL,
  p_to           date DEFAULT NULL
)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH e AS (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
  SELECT COALESCE(json_agg(row_to_json(o.*) ORDER BY o.date), '[]'::json)
  FROM public.off_requests o, e
  WHERE o.employee_id = e.id
    AND (p_from IS NULL OR o.date >= p_from)
    AND (p_to   IS NULL OR o.date <= p_to)
$$;

GRANT EXECUTE ON FUNCTION public.liff_list_off_requests(text, date, date) TO authenticated, anon;

COMMIT;
