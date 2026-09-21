-- =============================================
-- HR 5 張新表接 approval_chains（最小可行版）
--
-- 對齊 expense_requests 模式：approval_chain_id + current_step (0-indexed)
-- 加 DB trigger：status → '已核准' 時自動 cascade 副作用
--
-- 範圍：
--   - resignation_requests   → 員工 status='離職', resign_date, resign_reason
--   - personnel_transfer_requests → 寫 position_history + update employees
--   - leave_of_absence_requests → 員工 status='留停' (要先確認 employees.status 接受此值)
-- =============================================

BEGIN;

-- ── 1. 加 current_step (0-indexed，對齊 expense_requests) ──
ALTER TABLE public.resignation_requests
  ADD COLUMN IF NOT EXISTS current_step INT NOT NULL DEFAULT 0;

ALTER TABLE public.leave_of_absence_requests
  ADD COLUMN IF NOT EXISTS current_step INT NOT NULL DEFAULT 0;

ALTER TABLE public.personnel_transfer_requests
  ADD COLUMN IF NOT EXISTS current_step INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_resign_chain_step
  ON public.resignation_requests(approval_chain_id, current_step) WHERE status = '申請中';

CREATE INDEX IF NOT EXISTS idx_loa_chain_step
  ON public.leave_of_absence_requests(approval_chain_id, current_step) WHERE status = '申請中';

CREATE INDEX IF NOT EXISTS idx_transfer_chain_step
  ON public.personnel_transfer_requests(approval_chain_id, current_step) WHERE status = '申請中';


-- ── 2. resignation 核准 → cascade employees ──
CREATE OR REPLACE FUNCTION public.trg_resignation_apply_on_approve()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = '已核准' AND (OLD.status IS DISTINCT FROM '已核准') THEN
    UPDATE employees
       SET status = '離職',
           resign_date = NEW.planned_resign_date,
           resign_reason = NEW.reason || COALESCE('（' || NEW.reason_detail || '）', '')
     WHERE id = NEW.employee_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_resign_cascade ON public.resignation_requests;
CREATE TRIGGER trg_resign_cascade
  AFTER UPDATE ON public.resignation_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_resignation_apply_on_approve();


-- ── 3. transfer 核准 → 寫 position_history + 更新 employees ──
CREATE OR REPLACE FUNCTION public.trg_transfer_apply_on_approve()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = '已核准' AND (OLD.status IS DISTINCT FROM '已核准') THEN
    -- 結束舊紀錄
    UPDATE position_history
       SET end_date = NEW.effective_date - INTERVAL '1 day'
     WHERE employee_id = NEW.employee_id
       AND end_date IS NULL;

    -- 寫新紀錄
    INSERT INTO position_history(
      employee_id, organization_id, effective_date, end_date,
      department_id, store_id, position, base_salary, role,
      change_type, reason, source_request_id, changed_by
    ) VALUES (
      NEW.employee_id, NEW.organization_id, NEW.effective_date, NULL,
      COALESCE(NEW.new_department_id, NEW.old_department_id),
      COALESCE(NEW.new_store_id, NEW.old_store_id),
      COALESCE(NEW.new_position, NEW.old_position),
      COALESCE(NEW.new_base_salary, NEW.old_base_salary),
      COALESCE(NEW.new_role, NEW.old_role),
      NEW.transfer_type, NEW.reason, NEW.id, NEW.approver_id
    );

    -- 更新 employees 主檔（只改有指定的欄位）
    UPDATE employees SET
      department_id = COALESCE(NEW.new_department_id, department_id),
      store_id      = COALESCE(NEW.new_store_id, store_id),
      position      = COALESCE(NEW.new_position, position),
      base_salary   = COALESCE(NEW.new_base_salary, base_salary)
    WHERE id = NEW.employee_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_transfer_cascade ON public.personnel_transfer_requests;
CREATE TRIGGER trg_transfer_cascade
  AFTER UPDATE ON public.personnel_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_transfer_apply_on_approve();


-- ── 4. leave_of_absence 核准 → employees.status='留停' ──
-- (notes: 假設 employees.status 沒有 CHECK constraint 或 enum 限制；若有，需先擴充)
CREATE OR REPLACE FUNCTION public.trg_loa_apply_on_approve()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = '已核准' AND (OLD.status IS DISTINCT FROM '已核准') THEN
    UPDATE employees
       SET status = '留停'
     WHERE id = NEW.employee_id;
  END IF;
  -- 若有實際回任日 → 改回在職
  IF NEW.actual_return_date IS NOT NULL AND OLD.actual_return_date IS NULL THEN
    UPDATE employees
       SET status = '在職'
     WHERE id = NEW.employee_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_loa_cascade ON public.leave_of_absence_requests;
CREATE TRIGGER trg_loa_cascade
  AFTER UPDATE ON public.leave_of_absence_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_loa_apply_on_approve();


-- ── 5. 通用 RPC：HR 申請類核准/退回（沿用 chain，對齊 expense_request 模式） ──
CREATE OR REPLACE FUNCTION public.hr_chain_approve(
  p_table        text,    -- 'resignation' | 'loa' | 'transfer'
  p_id           int,
  p_approver_id  int,
  p_action       text,    -- 'approve' | 'reject'
  p_reason       text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table_name  text;
  v_record      record;
  v_chain_id    int;
  v_cur_step    int;
  v_total_steps int;
  v_step        record;
  v_is_last     boolean;
  v_next_step   record;
  v_next_ids    int[];
  v_next_json   json;
BEGIN
  -- 表對應
  v_table_name := CASE p_table
    WHEN 'resignation' THEN 'resignation_requests'
    WHEN 'loa'         THEN 'leave_of_absence_requests'
    WHEN 'transfer'    THEN 'personnel_transfer_requests'
    ELSE NULL
  END;
  IF v_table_name IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_TABLE');
  END IF;
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  -- 取單 (動態 SQL)
  EXECUTE format('SELECT id, approval_chain_id, current_step, status, employee_id, organization_id FROM %I WHERE id = $1', v_table_name)
    INTO v_record USING p_id;

  IF v_record.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_record.status <> '申請中' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  v_chain_id := v_record.approval_chain_id;
  v_cur_step := v_record.current_step;

  -- 沒接 chain → 直接核准/駁回（後備）
  IF v_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW() WHERE id=$3', v_table_name)
        USING '已核准', p_approver_id, p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved_no_chain');
    ELSE
      EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW(), reject_reason=$3 WHERE id=$4', v_table_name)
        USING '已駁回', p_approver_id, btrim(p_reason), p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected_no_chain');
    END IF;
  END IF;

  -- 取目前這一關
  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = v_cur_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND');
  END IF;

  -- 簽核者驗證
  IF NOT public._employee_matches_chain_step(p_approver_id, v_step.id) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_chain_id;
  v_is_last := (v_cur_step + 1 >= v_total_steps);

  -- reject → 退回（保留 current_step，B2 模式）
  IF p_action = 'reject' THEN
    EXECUTE format('UPDATE %I SET status=$1, reject_reason=$2, approver_id=$3 WHERE id=$4', v_table_name)
      USING '已駁回', btrim(p_reason), p_approver_id, p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected', 'rejected_at_step', v_cur_step);
  END IF;

  -- approve
  IF v_is_last THEN
    EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW() WHERE id=$3', v_table_name)
      USING '已核准', p_approver_id, p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved', 'is_last_step', true);
  ELSE
    EXECUTE format('UPDATE %I SET current_step=current_step+1 WHERE id=$1', v_table_name) USING p_id;

    SELECT * INTO v_next_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = v_cur_step + 1;

    SELECT array_agg(e.id) INTO v_next_ids FROM employees e
     WHERE e.status = '在職'
       AND e.organization_id = v_record.organization_id
       AND public._employee_matches_chain_step(e.id, v_next_step.id);

    SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_json
      FROM employees WHERE id = ANY(COALESCE(v_next_ids, ARRAY[]::INT[]));

    RETURN json_build_object(
      'ok', true, 'status', '申請中', 'event', 'advanced',
      'advanced_to_step', v_cur_step + 1,
      'is_last_step', false,
      'next_approvers', COALESCE(v_next_json, '[]'::json)
    );
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.hr_chain_approve(text, int, int, text, text) TO authenticated;


-- ── 6. RPC：HR 申請送出時自動找 chain + 推第一關 ──
CREATE OR REPLACE FUNCTION public.hr_chain_resolve_first_approvers(
  p_table     text,
  p_id        int
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table_name text;
  v_chain_id   int;
  v_cur_step   int;
  v_org_id     int;
  v_step       record;
  v_ids        int[];
  v_result     json;
BEGIN
  v_table_name := CASE p_table
    WHEN 'resignation' THEN 'resignation_requests'
    WHEN 'loa'         THEN 'leave_of_absence_requests'
    WHEN 'transfer'    THEN 'personnel_transfer_requests'
    ELSE NULL
  END;
  IF v_table_name IS NULL THEN RETURN '[]'::json; END IF;

  EXECUTE format('SELECT approval_chain_id, current_step, organization_id FROM %I WHERE id=$1', v_table_name)
    INTO v_chain_id, v_cur_step, v_org_id USING p_id;

  IF v_chain_id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = v_cur_step;
  IF v_step.id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT array_agg(e.id) INTO v_ids FROM employees e
   WHERE e.status = '在職' AND e.organization_id = v_org_id
     AND public._employee_matches_chain_step(e.id, v_step.id);

  SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_result
    FROM employees WHERE id = ANY(COALESCE(v_ids, ARRAY[]::INT[]));

  RETURN COALESCE(v_result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.hr_chain_resolve_first_approvers(text, int) TO authenticated;


COMMIT;
