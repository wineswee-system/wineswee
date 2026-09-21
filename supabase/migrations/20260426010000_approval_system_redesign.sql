-- ============================================================
-- 簽核系統大重整（依老闆 2026-04-26 拍板）
--
-- 規則：
--   1) 只有「申請」(expense_requests) 走 approval_chains
--      其他 6 種單據（請假/加班/出差/補打卡/報帳/任務確認）走自動解析
--   2) 駁回 = 退回給申請人改後重送（B2 模式）
--      申請類退回後 current_step 不重置，從被退的那關繼續
--   3) HR 類自動找簽核者：
--      - 一般員工 → 所在店店長 (employees.store_id → stores.manager_id)
--        店長若 NULL → supervisor_id → dept.manager_id → 上層 dept manager → ...
--        全部 NULL → 視為老闆，自動核准（『組織圖頂端不需要簽核』）
--      - 店長本人請假 → 走有 leave.approve 權限的人（HR）
--   4) task_confirmations 從簽核中心拿掉，改放 LIFF Tasks 頁
--   5) 多租戶：所有表補 organization_id 過濾
--   6) RPC 回傳下一關簽核者 + 申請人資訊，給 client 推 LINE
-- ============================================================

BEGIN;


-- ════════════════════════════════════════════════════════════
-- ═══ Section 1. Schema additions ═══
-- ════════════════════════════════════════════════════════════

-- 申請：current_step 追卡在第幾關（0-indexed，對齊 approval_chain_steps.step_order）
ALTER TABLE public.expense_requests
  ADD COLUMN IF NOT EXISTS current_step INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_expense_req_chain_step
  ON public.expense_requests(approval_chain_id, current_step) WHERE status = '申請中';

COMMENT ON COLUMN public.expense_requests.current_step IS
  '目前等待簽核的 approval_chain_steps.step_order（0-indexed）。退回保留不動，重送從這關繼續';

-- task_confirmations 補 organization_id（多租戶保護）
ALTER TABLE public.task_confirmations
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;

UPDATE public.task_confirmations tc
   SET organization_id = t.organization_id
  FROM public.tasks t
 WHERE tc.task_id = t.id
   AND tc.organization_id IS NULL
   AND t.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_conf_org_status
  ON public.task_confirmations(organization_id, status);

-- notifications：補 recipient_emp_id + payload，給 client 推 LINE 用
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS recipient_emp_id INT REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payload JSONB;

CREATE INDEX IF NOT EXISTS idx_notif_recipient_emp
  ON public.notifications(recipient_emp_id, read) WHERE recipient_emp_id IS NOT NULL;


-- ════════════════════════════════════════════════════════════
-- ═══ Section 2. Org chart helpers ═══
-- ════════════════════════════════════════════════════════════

-- 解析「一般員工」的單一簽核者：店長 → supervisor → dept manager → 上層 dept manager
-- 回 NULL = 員工是組織頂端（老闆），不需要簽核
CREATE OR REPLACE FUNCTION public._resolve_single_approver(p_emp_id INT)
RETURNS INT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp        employees;
  v_approver   INT;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN RETURN NULL; END IF;

  -- 1. 店長
  IF v_emp.store_id IS NOT NULL THEN
    SELECT manager_id INTO v_approver FROM stores WHERE id = v_emp.store_id;
    IF v_approver IS NOT NULL AND v_approver <> p_emp_id THEN
      RETURN v_approver;
    END IF;
  END IF;

  -- 2. 直屬主管
  IF v_emp.supervisor_id IS NOT NULL AND v_emp.supervisor_id <> p_emp_id THEN
    RETURN v_emp.supervisor_id;
  END IF;

  -- 3. 部門主管
  IF v_emp.department_id IS NOT NULL THEN
    SELECT manager_id INTO v_approver FROM departments WHERE id = v_emp.department_id;
    IF v_approver IS NOT NULL AND v_approver <> p_emp_id THEN
      RETURN v_approver;
    END IF;
  END IF;

  -- 4. 沿部門樹往上找
  IF v_emp.department_id IS NOT NULL THEN
    WITH RECURSIVE dept_chain AS (
      SELECT id, parent_department_id, manager_id, 1 AS lvl
        FROM departments WHERE id = v_emp.department_id
      UNION ALL
      SELECT d.id, d.parent_department_id, d.manager_id, dc.lvl + 1
        FROM departments d JOIN dept_chain dc ON d.id = dc.parent_department_id
       WHERE dc.lvl < 10
    )
    SELECT manager_id INTO v_approver
      FROM dept_chain
     WHERE manager_id IS NOT NULL AND manager_id <> p_emp_id
     ORDER BY lvl ASC LIMIT 1
       OFFSET 1;  -- skip lvl=1 (already checked above)
    IF v_approver IS NOT NULL THEN RETURN v_approver; END IF;
  END IF;

  -- 5. 全部沒有 → 老闆
  RETURN NULL;
END $$;

GRANT EXECUTE ON FUNCTION public._resolve_single_approver(INT) TO authenticated, anon;


-- 判斷是不是「店長本人」（自己是某個 store 的 manager）
CREATE OR REPLACE FUNCTION public._is_store_manager(p_emp_id INT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM stores WHERE manager_id = p_emp_id);
$$;

GRANT EXECUTE ON FUNCTION public._is_store_manager(INT) TO authenticated, anon;


-- 解析 HR 類單據的合法簽核者集合
--   - 申請人是店長 → 任何有 leave.approve 權限的人（HR）
--   - 否則 → 用 _resolve_single_approver
--   - 老闆（top of chart）→ 空集合（caller 應自動核准）
CREATE OR REPLACE FUNCTION public._resolve_hr_approver_ids(p_applicant_id INT)
RETURNS SETOF INT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp     employees;
  v_single  INT;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_applicant_id;
  IF v_emp.id IS NULL THEN RETURN; END IF;

  -- 店長本人 → 走 HR
  IF public._is_store_manager(p_applicant_id) THEN
    RETURN QUERY
      SELECT DISTINCT e.id
        FROM employees e
        JOIN role_permissions rp ON rp.role_id = e.role_id
        JOIN permissions p       ON p.id = rp.permission_id
       WHERE p.code = 'leave.approve'
         AND e.organization_id = v_emp.organization_id
         AND e.status = '在職'
         AND e.id <> p_applicant_id;
    RETURN;
  END IF;

  -- 一般員工：單一簽核者
  v_single := public._resolve_single_approver(p_applicant_id);
  IF v_single IS NOT NULL THEN
    RETURN NEXT v_single;
  END IF;
  -- v_single IS NULL = 老闆，回空集合
END $$;

GRANT EXECUTE ON FUNCTION public._resolve_hr_approver_ids(INT) TO authenticated, anon;


-- chain step 簽核者匹配（給「申請」用，沿用之前的 _employee_matches_chain_step 邏輯）
CREATE OR REPLACE FUNCTION public._employee_matches_chain_step(
  p_emp_id  INT,
  p_step_id INT
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM approval_chain_steps s
    JOIN employees e ON e.id = p_emp_id
    WHERE s.id = p_step_id
      AND (
        (s.target_type = 'employee'   AND s.target_emp_id  = e.id)
     OR (s.target_type = 'department' AND s.target_dept_id = e.department_id)
     OR (s.target_type = 'role'       AND s.target_role_id = e.role_id)
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public._employee_matches_chain_step(INT, INT) TO authenticated, anon;


-- ════════════════════════════════════════════════════════════
-- ═══ Section 3. HR 自動核准 trigger（老闆自己提的單）═══
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_hr_auto_approve_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp_id INT;
BEGIN
  -- 取得 employee_id（優先 FK，後備 name lookup）
  v_emp_id := NEW.employee_id;
  IF v_emp_id IS NULL AND NEW.employee IS NOT NULL THEN
    SELECT id INTO v_emp_id FROM employees
     WHERE name = NEW.employee
       AND organization_id = COALESCE(NEW.organization_id,
           (SELECT organization_id FROM employees WHERE name = NEW.employee LIMIT 1))
     LIMIT 1;
  END IF;

  IF v_emp_id IS NULL THEN RETURN NEW; END IF;

  -- 檢查是否為組織頂端（無人可簽）
  IF public._resolve_single_approver(v_emp_id) IS NULL
     AND NOT public._is_store_manager(v_emp_id) THEN
    -- 是老闆 → 直接核准
    NEW.status := CASE TG_TABLE_NAME
      WHEN 'expenses' THEN '已核銷'
      ELSE '已核准'
    END;
    -- 兼容 leave/overtime 有 approver 欄位
    BEGIN NEW.approver := '系統(自動)'; EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_leave_auto_owner ON public.leave_requests;
CREATE TRIGGER trg_leave_auto_owner
  BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_hr_auto_approve_owner();

DROP TRIGGER IF EXISTS trg_ot_auto_owner ON public.overtime_requests;
CREATE TRIGGER trg_ot_auto_owner
  BEFORE INSERT ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_hr_auto_approve_owner();

DROP TRIGGER IF EXISTS trg_trip_auto_owner ON public.business_trips;
CREATE TRIGGER trg_trip_auto_owner
  BEFORE INSERT ON public.business_trips
  FOR EACH ROW EXECUTE FUNCTION public.trg_hr_auto_approve_owner();

DROP TRIGGER IF EXISTS trg_correction_auto_owner ON public.clock_corrections;
CREATE TRIGGER trg_correction_auto_owner
  BEFORE INSERT ON public.clock_corrections
  FOR EACH ROW EXECUTE FUNCTION public.trg_hr_auto_approve_owner();

DROP TRIGGER IF EXISTS trg_expense_auto_owner ON public.expenses;
CREATE TRIGGER trg_expense_auto_owner
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_hr_auto_approve_owner();


-- ════════════════════════════════════════════════════════════
-- ═══ Section 4. liff_list_pending_approvals 重寫 ═══
-- ════════════════════════════════════════════════════════════
-- - leave/overtime/trip/correction/expense：依 _resolve_hr_approver_ids 過濾
-- - expense_request (申請)：依 chain step 過濾
-- - 移除 task_confirmations
-- - 全部加 organization_id 守門
-- ════════════════════════════════════════════════════════════

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
    -- 申請：走 chain，員工必須是 current_step 的合法簽核者
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
    -- 任務確認：保留欄位但永遠空（已移到 Tasks 頁，靠新 RPC liff_list_my_task_confirmations）
    'task_confirmations', '[]'::json,
    'can', json_build_object(
      'hr', public.liff_employee_has_permission(emp.id, 'leave.approve'),
      'finance', public.liff_employee_has_permission(emp.id, 'finance.edit')
    )
  ) INTO result;

  RETURN result;
END $$;


-- ════════════════════════════════════════════════════════════
-- ═══ Section 5. liff_approve_request 重寫（B2 退回 + chain step 推進）═══
-- ════════════════════════════════════════════════════════════

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
  emp           employees;
  v_app_emp_id  INT;     -- applicant employee id (for HR resolution)
  v_app_name    TEXT;
  v_app_org     INT;
  v_eligible    BOOLEAN;
  reject_val    text;
  approve_status text;
  reject_status  text;
  result_status  text;
  v_er          record;
  v_cur_step    record;
  v_total_steps int;
  v_is_last     boolean;
  v_next_step   record;
  v_next_approver_ids INT[];
  v_next_approvers JSON;
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

  reject_val := CASE WHEN p_action = 'reject' THEN btrim(p_reason) ELSE NULL END;

  -- ════ HR 類（leave/overtime/trip/correction/expense）═══
  IF p_type IN ('leave','overtime','trip','correction','expense') THEN
    -- 取得申請人 id
    IF p_type = 'leave' THEN
      SELECT employee_id, employee, organization_id INTO v_app_emp_id, v_app_name, v_app_org
        FROM leave_requests WHERE id = p_id AND status = '待審核';
    ELSIF p_type = 'overtime' THEN
      SELECT employee_id, employee, organization_id INTO v_app_emp_id, v_app_name, v_app_org
        FROM overtime_requests WHERE id = p_id AND status = '待審核';
    ELSIF p_type = 'trip' THEN
      SELECT NULL::INT, employee, organization_id INTO v_app_emp_id, v_app_name, v_app_org
        FROM business_trips WHERE id = p_id AND status = '待審核';
    ELSIF p_type = 'correction' THEN
      SELECT NULL::INT, employee, NULL::INT INTO v_app_emp_id, v_app_name, v_app_org
        FROM clock_corrections WHERE id = p_id AND status = '待審核';
    ELSE  -- expense
      SELECT NULL::INT, employee, NULL::INT INTO v_app_emp_id, v_app_name, v_app_org
        FROM expenses WHERE id = p_id AND status = '待審核';
    END IF;

    IF v_app_name IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;

    -- name lookup if no FK
    IF v_app_emp_id IS NULL THEN
      SELECT id INTO v_app_emp_id FROM employees
       WHERE name = v_app_name AND organization_id = COALESCE(v_app_org, emp.organization_id)
       LIMIT 1;
    END IF;

    IF v_app_emp_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'APPLICANT_NOT_FOUND');
    END IF;

    -- 跨組織守門
    IF v_app_org IS NOT NULL AND v_app_org <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;

    -- 是不是合法簽核者？
    SELECT EXISTS (
      SELECT 1 FROM public._resolve_hr_approver_ids(v_app_emp_id) WHERE _resolve_hr_approver_ids = emp.id
    ) INTO v_eligible;

    IF NOT v_eligible THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;

    -- 狀態詞（B2：駁回統一用「已退回」，可重送）
    approve_status := CASE p_type WHEN 'expense' THEN '已核銷' ELSE '已核准' END;
    reject_status  := '已退回';
    result_status  := CASE p_action WHEN 'approve' THEN approve_status ELSE reject_status END;

    -- 寫狀態
    IF p_type = 'leave' THEN
      UPDATE leave_requests SET status = result_status, approver = emp.name, reject_reason = reject_val
       WHERE id = p_id;
    ELSIF p_type = 'overtime' THEN
      UPDATE overtime_requests SET status = result_status, approver = emp.name, reject_reason = reject_val
       WHERE id = p_id;
    ELSIF p_type = 'trip' THEN
      UPDATE business_trips SET status = result_status, approver = emp.name, reject_reason = reject_val
       WHERE id = p_id;
    ELSIF p_type = 'correction' THEN
      UPDATE clock_corrections SET status = result_status, approver = emp.name, reject_reason = reject_val
       WHERE id = p_id;
      -- 補打卡核准 → 寫 attendance_records
      IF p_action = 'approve' THEN
        DECLARE
          c record; new_in time; new_out time; existing record;
        BEGIN
          SELECT * INTO c FROM clock_corrections WHERE id = p_id;
          IF c.correction_time IS NOT NULL THEN
            new_in  := CASE WHEN c.type = '上班打卡' THEN c.correction_time END;
            new_out := CASE WHEN c.type = '下班打卡' THEN c.correction_time END;
            SELECT * INTO existing FROM attendance_records WHERE employee = c.employee AND date = c.date LIMIT 1;
            IF FOUND THEN
              UPDATE attendance_records SET clock_in = COALESCE(new_in, clock_in), clock_out = COALESCE(new_out, clock_out) WHERE id = existing.id;
            ELSE
              INSERT INTO attendance_records (employee, date, clock_in, clock_out, status) VALUES (c.employee, c.date, new_in, new_out, '補登');
            END IF;
          END IF;
        END;
      END IF;
    ELSE  -- expense
      UPDATE expenses SET status = result_status, approver = emp.name, reject_reason = reject_val
       WHERE id = p_id;
    END IF;

    RETURN json_build_object(
      'ok', true,
      'status', result_status,
      'event', CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
      'applicant', json_build_object('emp_id', v_app_emp_id, 'name', v_app_name)
    );
  END IF;

  -- ════ 申請（expense_request）走 chain ════
  IF p_type = 'expense_request' THEN
    SELECT * INTO v_er FROM expense_requests WHERE id = p_id;
    IF v_er.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;
    IF v_er.status <> '申請中' THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
    END IF;
    IF v_er.organization_id IS NOT NULL AND v_er.organization_id <> emp.organization_id THEN
      RETURN json_build_object('ok', false, 'error', 'ORG_MISMATCH');
    END IF;
    IF v_er.approval_chain_id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'NO_CHAIN_ATTACHED');
    END IF;

    SELECT * INTO v_cur_step
      FROM approval_chain_steps
     WHERE chain_id = v_er.approval_chain_id
       AND step_order = v_er.current_step;
    IF v_cur_step.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
    END IF;
    IF NOT public._employee_matches_chain_step(emp.id, v_cur_step.id) THEN
      RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
    END IF;

    SELECT COUNT(*) INTO v_total_steps
      FROM approval_chain_steps WHERE chain_id = v_er.approval_chain_id;
    v_is_last := (v_er.current_step + 1 >= v_total_steps);

    IF p_action = 'reject' THEN
      -- B2：退回，current_step 保留，申請人改完從這關繼續
      UPDATE expense_requests
         SET status = '已退回',
             reject_reason = reject_val,
             approved_by = emp.name
       WHERE id = p_id;
      RETURN json_build_object(
        'ok', true,
        'status', '已退回',
        'event', 'rejected',
        'rejected_at_step', v_er.current_step,
        'applicant', json_build_object('emp_id',
          (SELECT id FROM employees WHERE name = v_er.employee AND organization_id = v_er.organization_id LIMIT 1),
          'name', v_er.employee)
      );
    END IF;

    -- approve
    IF v_is_last THEN
      UPDATE expense_requests
         SET status = '已核准', approved_by = emp.name, approved_at = NOW()
       WHERE id = p_id;
      RETURN json_build_object(
        'ok', true, 'status', '已核准', 'event', 'approved', 'is_last_step', true,
        'applicant', json_build_object('emp_id',
          (SELECT id FROM employees WHERE name = v_er.employee AND organization_id = v_er.organization_id LIMIT 1),
          'name', v_er.employee)
      );
    ELSE
      UPDATE expense_requests SET current_step = current_step + 1 WHERE id = p_id;

      -- 找下一關的合法簽核者
      SELECT * INTO v_next_step
        FROM approval_chain_steps
       WHERE chain_id = v_er.approval_chain_id
         AND step_order = v_er.current_step + 1;

      SELECT array_agg(e.id) INTO v_next_approver_ids
        FROM employees e
       WHERE e.status = '在職'
         AND e.organization_id = v_er.organization_id
         AND public._employee_matches_chain_step(e.id, v_next_step.id);

      SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_approvers
        FROM employees WHERE id = ANY(COALESCE(v_next_approver_ids, ARRAY[]::INT[]));

      RETURN json_build_object(
        'ok', true, 'status', '簽核中', 'event', 'advanced',
        'advanced_to_step', v_er.current_step + 1,
        'is_last_step', false,
        'next_approvers', COALESCE(v_next_approvers, '[]'::json),
        'applicant', json_build_object('emp_id',
          (SELECT id FROM employees WHERE name = v_er.employee AND organization_id = v_er.organization_id LIMIT 1),
          'name', v_er.employee)
      );
    END IF;
  END IF;

  RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
END $$;

GRANT EXECUTE ON FUNCTION public.liff_approve_request(text, text, int, text, text) TO authenticated, anon;


-- ════════════════════════════════════════════════════════════
-- ═══ Section 6. 新 RPC：Tasks 頁顯示「需我審核的任務」═══
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_list_my_task_confirmations(p_line_user_id text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'id',                  tc.id,
      'task_id',             t.id,
      'task_title',          t.title,
      'task_description',    t.description,
      'task_status',         t.status,
      'task_assignee',       t.assignee,
      'task_store',          t.store,
      'task_due_date',       t.due_date,
      'task_completed_at',   t.completed_at,
      'workflow_instance_id', t.workflow_instance_id,
      'workflow_name',       wi.template_name,
      'priority',            t.priority,
      'created_at',          tc.created_at
    ) ORDER BY tc.created_at DESC)
    FROM public.task_confirmations tc
    JOIN public.tasks t ON t.id = tc.task_id
    LEFT JOIN public.workflow_instances wi ON wi.id = t.workflow_instance_id
    WHERE tc.approver = emp.name
      AND tc.status = 'pending'
      AND (tc.organization_id IS NULL OR tc.organization_id = emp.organization_id)
      AND t.status IN ('待確認', '已完成')
  ), '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_my_task_confirmations(text) TO authenticated, anon;


-- task_confirmation 審批獨立 RPC（不再走 liff_approve_request）
CREATE OR REPLACE FUNCTION public.liff_respond_task_confirmation(
  p_line_user_id text,
  p_id           int,
  p_action       text,
  p_notes        text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  v_status text;
  n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_notes IS NULL OR btrim(p_notes) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  v_status := CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END;

  UPDATE task_confirmations
     SET status = v_status,
         notes = CASE WHEN p_action = 'reject' THEN btrim(p_notes) ELSE notes END,
         responded_at = NOW()
   WHERE id = p_id
     AND approver = emp.name
     AND status = 'pending'
     AND (organization_id IS NULL OR organization_id = emp.organization_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
  END IF;
  RETURN json_build_object('ok', true, 'status', v_status);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_respond_task_confirmation(text, int, text, text) TO authenticated, anon;


-- ════════════════════════════════════════════════════════════
-- ═══ Section 7. 申請人重新提交退回的單（B2）═══
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_resubmit_request(
  p_line_user_id text,
  p_type         text,
  p_id           int,
  p_changes      jsonb DEFAULT NULL  -- 可選：要修改的欄位
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  n int;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_type = 'leave' THEN
    UPDATE leave_requests
       SET status = '待審核',
           reject_reason = NULL,
           reason       = COALESCE(p_changes->>'reason', reason),
           start_date   = COALESCE((p_changes->>'start_date')::date, start_date),
           end_date     = COALESCE((p_changes->>'end_date')::date, end_date),
           hours        = COALESCE((p_changes->>'hours')::numeric, hours)
     WHERE id = p_id AND status = '已退回'
       AND (employee_id = emp.id OR employee = emp.name)
       AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF p_type = 'overtime' THEN
    UPDATE overtime_requests
       SET status = '待審核', reject_reason = NULL,
           reason = COALESCE(p_changes->>'reason', reason),
           date   = COALESCE((p_changes->>'date')::date, date),
           hours  = COALESCE((p_changes->>'hours')::numeric, hours)
     WHERE id = p_id AND status = '已退回'
       AND (employee_id = emp.id OR employee = emp.name)
       AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF p_type = 'trip' THEN
    UPDATE business_trips SET status = '待審核', reject_reason = NULL
     WHERE id = p_id AND status = '已退回'
       AND employee = emp.name AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF p_type = 'correction' THEN
    UPDATE clock_corrections SET status = '待審核', reject_reason = NULL
     WHERE id = p_id AND status = '已退回' AND employee = emp.name;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF p_type = 'expense' THEN
    UPDATE expenses SET status = '待審核', reject_reason = NULL
     WHERE id = p_id AND status = '已退回' AND employee = emp.name;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF p_type = 'expense_request' THEN
    -- 申請：current_step 不重置（B2 從被退的那關繼續）
    UPDATE expense_requests
       SET status = '申請中', reject_reason = NULL
     WHERE id = p_id AND status = '已退回'
       AND employee = emp.name AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSE
    RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
  END IF;

  IF n = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_NOT_REJECTED');
  END IF;
  RETURN json_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_resubmit_request(text, text, int, jsonb) TO authenticated, anon;


-- ════════════════════════════════════════════════════════════
-- ═══ Section 8. 新 RPC：申請送出時若申請人是老闆，直接核准 ═══
-- ═══ + 申請送出時找出第 1 關簽核者（給 client 推 LINE）═══
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_resolve_chain_first_approvers(p_request_id INT)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_er record;
  v_step record;
  v_ids INT[];
  v_result json;
BEGIN
  SELECT * INTO v_er FROM expense_requests WHERE id = p_request_id;
  IF v_er.approval_chain_id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT * INTO v_step
    FROM approval_chain_steps
   WHERE chain_id = v_er.approval_chain_id AND step_order = v_er.current_step;
  IF v_step.id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT array_agg(e.id) INTO v_ids FROM employees e
   WHERE e.status = '在職' AND e.organization_id = v_er.organization_id
     AND public._employee_matches_chain_step(e.id, v_step.id);

  SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_result
    FROM employees WHERE id = ANY(COALESCE(v_ids, ARRAY[]::INT[]));

  RETURN COALESCE(v_result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_resolve_chain_first_approvers(INT) TO authenticated, anon;


-- ════════════════════════════════════════════════════════════
-- ═══ Section 9. HR 單據送出時回傳簽核者（給 client 推 LINE）═══
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.liff_resolve_hr_approvers(p_applicant_emp_id INT)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_agg(json_build_object('emp_id', e.id, 'name', e.name))
    INTO v_result
    FROM employees e
   WHERE e.id IN (SELECT public._resolve_hr_approver_ids(p_applicant_emp_id));
  RETURN COALESCE(v_result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_resolve_hr_approvers(INT) TO authenticated, anon;


COMMIT;
