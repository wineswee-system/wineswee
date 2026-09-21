-- ════════════════════════════════════════════════════════════
-- 班別交換 兩段確認流程
-- ────────────────────────────────────────────────────────────
-- 流程：
--   A 提交（同店、同日）
--      → status='待對方同意'，LINE 通知 B
--   B 同意 → status='待主管核准'，LINE 通知店長
--   B 拒絕 → status='已拒絕'，LINE 通知 A（含理由）
--   店長 核准 → status='已核准'，自動 swap schedules，LINE 通知 A、B
--   店長 駁回 → status='已駁回'，LINE 通知 A、B（含理由）
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── Section 1. Schema additions ────────────────────────────

ALTER TABLE public.shift_swaps
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS store TEXT,
  ADD COLUMN IF NOT EXISTS store_id INT REFERENCES public.stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requester_id INT REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_id INT REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS swap_date DATE,
  ADD COLUMN IF NOT EXISTS requester_shift TEXT,
  ADD COLUMN IF NOT EXISTS target_shift TEXT,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS peer_response TEXT,             -- '同意' / '拒絕'
  ADD COLUMN IF NOT EXISTS peer_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS peer_reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS approver_id INT REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approver_name TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT;

-- 把舊 date 欄位資料搬到 swap_date（如果舊欄位還有資料）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shift_swaps' AND column_name='date') THEN
    UPDATE public.shift_swaps SET swap_date = date WHERE swap_date IS NULL AND date IS NOT NULL;
  END IF;
END $$;

-- 補 organization_id + requester_id（從 name lookup）
UPDATE public.shift_swaps ss SET organization_id = e.organization_id, requester_id = e.id
  FROM public.employees e
 WHERE ss.organization_id IS NULL AND ss.requester = e.name;

UPDATE public.shift_swaps ss SET target_id = e.id
  FROM public.employees e
 WHERE ss.target_id IS NULL AND ss.target = e.name AND e.organization_id = ss.organization_id;

-- 補 store_id + store（從 requester 員工 lookup）
UPDATE public.shift_swaps ss
   SET store_id = e.store_id, store = COALESCE(ss.store, e.store)
  FROM public.employees e
 WHERE ss.requester_id = e.id AND ss.store_id IS NULL;

-- 索引
CREATE INDEX IF NOT EXISTS idx_shift_swaps_target_pending
  ON public.shift_swaps(target_id) WHERE status = '待對方同意';
CREATE INDEX IF NOT EXISTS idx_shift_swaps_org_status
  ON public.shift_swaps(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_store_pending
  ON public.shift_swaps(store_id) WHERE status = '待主管核准';

-- 舊狀態相容（過去用 待確認/待審核，統一改為 待對方同意）
UPDATE public.shift_swaps SET status = '待對方同意' WHERE status IN ('待確認', '待審核');


-- ── Section 2. RPC: A 提交換班申請 ────────────────────────

DROP FUNCTION IF EXISTS public.liff_request_shift_swap(text, jsonb);
CREATE OR REPLACE FUNCTION public.liff_request_shift_swap(
  p_line_user_id text,
  p_payload      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp_a            employees;
  emp_b            employees;
  v_swap_date      DATE;
  v_a_sched        record;
  v_b_sched        record;
  v_store_id       INT;
  v_store_name     TEXT;
  v_manager_id     INT;
  new_id           INT;
BEGIN
  -- 1. 解析 A
  SELECT * INTO emp_a FROM public._liff_resolve_employee(p_line_user_id);
  IF emp_a.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 2. 解析 B
  SELECT * INTO emp_b FROM public.employees WHERE id = (p_payload->>'target_id')::int;
  IF emp_b.id IS NULL OR emp_b.organization_id <> emp_a.organization_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NOT_FOUND');
  END IF;

  IF emp_a.id = emp_b.id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CANNOT_SWAP_WITH_SELF');
  END IF;

  v_swap_date := (p_payload->>'swap_date')::date;
  IF v_swap_date IS NULL OR v_swap_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_DATE');
  END IF;

  -- 3. 兩人當天都要有班
  SELECT shift, store INTO v_a_sched
    FROM public.schedules
   WHERE date = v_swap_date
     AND (employee_id = emp_a.id OR employee = emp_a.name)
   LIMIT 1;
  IF v_a_sched.shift IS NULL OR v_a_sched.shift = '休' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REQUESTER_NO_SHIFT');
  END IF;

  SELECT shift, store INTO v_b_sched
    FROM public.schedules
   WHERE date = v_swap_date
     AND (employee_id = emp_b.id OR employee = emp_b.name)
   LIMIT 1;
  IF v_b_sched.shift IS NULL OR v_b_sched.shift = '休' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TARGET_NO_SHIFT');
  END IF;

  -- 4. 兩人必須同店（用 schedules.store 或 employees.store）
  IF COALESCE(v_a_sched.store, emp_a.store) IS DISTINCT FROM COALESCE(v_b_sched.store, emp_b.store) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DIFFERENT_STORE');
  END IF;

  v_store_name := COALESCE(v_a_sched.store, emp_a.store);
  SELECT id, manager_id INTO v_store_id, v_manager_id
    FROM public.stores WHERE name = v_store_name AND organization_id = emp_a.organization_id LIMIT 1;

  -- 5. 同 (A,B,date) 不能有未結案的單
  IF EXISTS (
    SELECT 1 FROM public.shift_swaps
     WHERE swap_date = v_swap_date
       AND ((requester_id = emp_a.id AND target_id = emp_b.id)
         OR (requester_id = emp_b.id AND target_id = emp_a.id))
       AND status IN ('待對方同意', '待主管核准')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DUPLICATE_PENDING_SWAP');
  END IF;

  -- 6. Insert
  INSERT INTO public.shift_swaps (
    requester, requester_id, target, target_id,
    swap_date, requester_shift, target_shift,
    reason, status, organization_id, store, store_id
  ) VALUES (
    emp_a.name, emp_a.id, emp_b.name, emp_b.id,
    v_swap_date, v_a_sched.shift, v_b_sched.shift,
    NULLIF(p_payload->>'reason', ''),
    '待對方同意', emp_a.organization_id, v_store_name, v_store_id
  )
  RETURNING id INTO new_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', new_id,
    'target_emp_id', emp_b.id,
    'target_name', emp_b.name,
    'manager_emp_id', v_manager_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_request_shift_swap(text, jsonb) TO authenticated, anon;


-- ── Section 3. RPC: B 同意/拒絕 ───────────────────────────

DROP FUNCTION IF EXISTS public.liff_respond_shift_swap_peer(text, int, text, text);
CREATE OR REPLACE FUNCTION public.liff_respond_shift_swap_peer(
  p_line_user_id text,
  p_swap_id      int,
  p_action       text,         -- 'agree' / 'reject'
  p_reason       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  v_swap        record;
  v_manager_id  INT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_swap FROM public.shift_swaps WHERE id = p_swap_id;
  IF v_swap.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  IF v_swap.target_id IS DISTINCT FROM emp.id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  IF v_swap.status <> '待對方同意' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  IF p_action = 'agree' THEN
    UPDATE public.shift_swaps
       SET status = '待主管核准',
           peer_response = '同意',
           peer_responded_at = now()
     WHERE id = p_swap_id;

    SELECT manager_id INTO v_manager_id FROM public.stores WHERE id = v_swap.store_id;

    RETURN jsonb_build_object(
      'ok', true, 'event', 'agreed',
      'manager_emp_id', v_manager_id,
      'requester_emp_id', v_swap.requester_id
    );
  ELSIF p_action = 'reject' THEN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
    END IF;

    UPDATE public.shift_swaps
       SET status = '已拒絕',
           peer_response = '拒絕',
           peer_responded_at = now(),
           peer_reject_reason = btrim(p_reason)
     WHERE id = p_swap_id;

    RETURN jsonb_build_object(
      'ok', true, 'event', 'rejected',
      'requester_emp_id', v_swap.requester_id,
      'reason', btrim(p_reason)
    );
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_respond_shift_swap_peer(text, int, text, text) TO authenticated, anon;


-- ── Section 4. RPC: 主管 核准/駁回 ────────────────────────

DROP FUNCTION IF EXISTS public.liff_approve_shift_swap_manager(text, int, text, text);
CREATE OR REPLACE FUNCTION public.liff_approve_shift_swap_manager(
  p_line_user_id text,
  p_swap_id      int,
  p_action       text,         -- 'approve' / 'reject'
  p_reason       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_swap     record;
  v_a_sched  record;
  v_b_sched  record;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_swap FROM public.shift_swaps WHERE id = p_swap_id;
  IF v_swap.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  IF v_swap.status <> '待主管核准' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AT_MANAGER_STAGE');
  END IF;

  -- 必須是該店店長 OR 有 schedule.approve 權限
  IF NOT (
    EXISTS (SELECT 1 FROM public.stores WHERE id = v_swap.store_id AND manager_id = emp.id)
    OR public.liff_employee_has_permission(emp.id, 'schedule.approve')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  END IF;

  IF p_action = 'approve' THEN
    -- 抓現在 schedules 真實值（避免 snapshot 過期）
    SELECT shift, actual_start, actual_end, actual_hours INTO v_a_sched
      FROM public.schedules
     WHERE date = v_swap.swap_date
       AND (employee_id = v_swap.requester_id OR employee = v_swap.requester)
     LIMIT 1;
    SELECT shift, actual_start, actual_end, actual_hours INTO v_b_sched
      FROM public.schedules
     WHERE date = v_swap.swap_date
       AND (employee_id = v_swap.target_id OR employee = v_swap.target)
     LIMIT 1;

    IF v_a_sched.shift IS NULL OR v_b_sched.shift IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SCHEDULE_MISSING');
    END IF;

    -- swap shift + actual_start/end/hours
    UPDATE public.schedules
       SET shift = v_b_sched.shift,
           actual_start = v_b_sched.actual_start,
           actual_end = v_b_sched.actual_end,
           actual_hours = v_b_sched.actual_hours
     WHERE date = v_swap.swap_date
       AND (employee_id = v_swap.requester_id OR employee = v_swap.requester);

    UPDATE public.schedules
       SET shift = v_a_sched.shift,
           actual_start = v_a_sched.actual_start,
           actual_end = v_a_sched.actual_end,
           actual_hours = v_a_sched.actual_hours
     WHERE date = v_swap.swap_date
       AND (employee_id = v_swap.target_id OR employee = v_swap.target);

    UPDATE public.shift_swaps
       SET status = '已核准',
           approver_id = emp.id,
           approver_name = emp.name,
           approved_at = now()
     WHERE id = p_swap_id;

    RETURN jsonb_build_object(
      'ok', true, 'event', 'approved',
      'requester_emp_id', v_swap.requester_id,
      'target_emp_id', v_swap.target_id
    );
  ELSIF p_action = 'reject' THEN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
    END IF;

    UPDATE public.shift_swaps
       SET status = '已駁回',
           approver_id = emp.id,
           approver_name = emp.name,
           approved_at = now(),
           reject_reason = btrim(p_reason)
     WHERE id = p_swap_id;

    RETURN jsonb_build_object(
      'ok', true, 'event', 'rejected_by_manager',
      'requester_emp_id', v_swap.requester_id,
      'target_emp_id', v_swap.target_id,
      'reason', btrim(p_reason)
    );
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.liff_approve_shift_swap_manager(text, int, text, text) TO authenticated, anon;


-- ── Section 5. RPC: 列出某日同店、有班的同事（給 A 選 target） ──

DROP FUNCTION IF EXISTS public.liff_list_swap_candidates(text, date);
CREATE OR REPLACE FUNCTION public.liff_list_swap_candidates(
  p_line_user_id text,
  p_date         date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_my_store TEXT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(s.store, emp.store) INTO v_my_store
    FROM public.schedules s
   WHERE s.date = p_date AND (s.employee_id = emp.id OR s.employee = emp.name)
   LIMIT 1;
  IF v_my_store IS NULL THEN v_my_store := emp.store; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'emp_id', e.id,
      'name', e.name,
      'shift', s.shift,
      'actual_start', s.actual_start,
      'actual_end', s.actual_end
    ) ORDER BY e.name)
    FROM public.schedules s
    JOIN public.employees e ON e.id = s.employee_id OR e.name = s.employee
   WHERE s.date = p_date
     AND COALESCE(s.store, e.store) = v_my_store
     AND s.shift IS NOT NULL AND s.shift <> '休'
     AND e.id <> emp.id
     AND e.organization_id = emp.organization_id
     AND e.status = '在職'
  ), '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_swap_candidates(text, date) TO authenticated, anon;


-- ── Section 6. RPC: 列我提交的 / 對我發起的 換班單 ───────

DROP FUNCTION IF EXISTS public.liff_list_my_shift_swaps(text);
CREATE OR REPLACE FUNCTION public.liff_list_my_shift_swaps(p_line_user_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC)
    FROM public.shift_swaps ss
   WHERE (ss.requester_id = emp.id OR ss.target_id = emp.id)
     AND ss.organization_id = emp.organization_id
  ), '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_shift_swaps(text) TO authenticated, anon;


-- ── Section 7. 加進 liff_list_pending_approvals ──────────
-- 兩個區段：
--   shift_swaps_for_peer — emp 是 target 且狀態 待對方同意
--   shift_swaps_for_manager — emp 是該店店長 且狀態 待主管核准

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
    -- ─── 班別交換：B 視角（要決定同意/拒絕） ───
    'shift_swaps_for_peer', (
      SELECT COALESCE(json_agg(row_to_json(ss.*) ORDER BY ss.created_at DESC), '[]'::json)
      FROM public.shift_swaps ss
      WHERE ss.organization_id = emp.organization_id
        AND ss.status = '待對方同意'
        AND ss.target_id = emp.id
    ),
    -- ─── 班別交換：店長視角（B 已同意，等核准） ───
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
    'can', json_build_object(
      'hr', public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', public.liff_employee_has_permission(emp.id, 'finance.edit')
    )
  ) INTO result;

  RETURN result;
END $$;

COMMIT;
