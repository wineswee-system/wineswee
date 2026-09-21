-- ════════════════════════════════════════════════════════════
-- 自動跳過重複審核人
-- 2026-05-20
--
-- 問題：同一條 chain 若某關的解析對象（員工 A）在後續某關再次出現，
--       A 會被要求簽核兩次。實際上只需最後那次即可。
--
-- 修法：
--   1. 新增 _resolve_step_single_approver — 把 chain step 解析成單一
--      員工 ID（multi-person 類型 fixed_role / fixed_dept 回 NULL，不處理）。
--   2. 新增 _step_approver_has_later_dup — 判斷某關的解析員工是否在
--      後續任何關再次出現。
--   3. 新增 BEFORE INSERT / UPDATE OF current_step 觸發器：
--      - expense_requests（在既有自簽跳過 trg_z_* 之後執行，命名 trg_zz_*）
--      - resignation_requests / leave_of_absence_requests /
--        personnel_transfer_requests / headcount_requests（HR B 類）
--
-- 行為：
--   - 每筆跳過的關卡都會在 approval_step_history 寫一筆 action='auto_skipped'，
--     notes='此關審核人將在後續關卡重複出現'，與自簽跳過紀錄格式一致。
--   - multi-person 關（fixed_role / fixed_dept）不做跳過判斷。
--   - 若整條 chain 解析後全是重複（極端情況），安全閥自動核准。
--
-- 不影響：
--   - 歷史已核准/駁回單（trigger 早 return）
--   - multi-person 關（fixed_role / fixed_dept）
--   - 跳過的 reason 與自簽跳過完全獨立，兩者可同一張單上同時出現
-- ════════════════════════════════════════════════════════════

BEGIN;


-- ═══ 1. _resolve_step_single_approver ═══════════════════════════════════════
-- 把 chain step 解析成單一員工 ID。
-- multi-person 類（fixed_role / fixed_dept）或解不出時回 NULL。
-- 解析邏輯與 resolve_chain_step_approvers 完全對齊。
CREATE OR REPLACE FUNCTION public._resolve_step_single_approver(
  p_chain_id         INT,
  p_step_order       INT,
  p_applicant_emp_id INT
) RETURNS INT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step        approval_chain_steps;
  v_app         employees;
  v_emp_id      INT;
  v_section_id  INT;
BEGIN
  SELECT * INTO v_step
    FROM approval_chain_steps
   WHERE chain_id = p_chain_id AND step_order = p_step_order;
  IF v_step.id IS NULL THEN RETURN NULL; END IF;

  -- multi-person：不做跳過判斷
  IF v_step.target_type IN ('fixed_role', 'fixed_dept') THEN RETURN NULL; END IF;

  SELECT * INTO v_app FROM employees WHERE id = p_applicant_emp_id;

  CASE v_step.target_type

    WHEN 'fixed_emp' THEN
      RETURN v_step.target_emp_id;

    WHEN 'applicant_dept_manager' THEN
      IF v_app.department_id IS NULL THEN RETURN NULL; END IF;
      SELECT d.manager_id INTO v_emp_id
        FROM departments d WHERE d.id = v_app.department_id;
      RETURN v_emp_id;

    WHEN 'applicant_store_manager' THEN
      IF v_app.store_id IS NULL THEN RETURN NULL; END IF;
      SELECT s.manager_id INTO v_emp_id
        FROM stores s WHERE s.id = v_app.store_id;
      RETURN v_emp_id;

    WHEN 'applicant_section_supervisor' THEN
      IF v_app.store_id IS NULL THEN RETURN NULL; END IF;
      SELECT s.section_id INTO v_section_id
        FROM stores s WHERE s.id = v_app.store_id;
      IF v_section_id IS NULL THEN RETURN NULL; END IF;
      SELECT ds.supervisor_id INTO v_emp_id
        FROM department_sections ds WHERE ds.id = v_section_id;
      RETURN v_emp_id;

    WHEN 'specific_dept_manager' THEN
      IF v_step.target_dept_id IS NULL THEN RETURN NULL; END IF;
      SELECT d.manager_id INTO v_emp_id
        FROM departments d WHERE d.id = v_step.target_dept_id;
      RETURN v_emp_id;

    WHEN 'specific_store_manager' THEN
      IF v_step.target_store_id IS NULL THEN RETURN NULL; END IF;
      SELECT s.manager_id INTO v_emp_id
        FROM stores s WHERE s.id = v_step.target_store_id;
      RETURN v_emp_id;

    WHEN 'specific_section_supervisor' THEN
      IF v_step.target_section_id IS NULL THEN RETURN NULL; END IF;
      SELECT ds.supervisor_id INTO v_emp_id
        FROM department_sections ds WHERE ds.id = v_step.target_section_id;
      RETURN v_emp_id;

    ELSE
      RETURN NULL;
  END CASE;
END $$;

GRANT EXECUTE ON FUNCTION public._resolve_step_single_approver(INT, INT, INT)
  TO authenticated, service_role;


-- ═══ 2. _step_approver_has_later_dup ════════════════════════════════════════
-- 回 TRUE 若 p_step_order 這關解到的員工，在後續某關也解到同一員工。
-- 用於觸發「跳過較早那關」。
CREATE OR REPLACE FUNCTION public._step_approver_has_later_dup(
  p_chain_id         INT,
  p_step_order       INT,
  p_applicant_emp_id INT
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cur_approver   INT;
  v_later_approver INT;
  v_later_step     approval_chain_steps;
BEGIN
  v_cur_approver := public._resolve_step_single_approver(
    p_chain_id, p_step_order, p_applicant_emp_id
  );
  IF v_cur_approver IS NULL THEN RETURN FALSE; END IF;

  FOR v_later_step IN
    SELECT * FROM approval_chain_steps
     WHERE chain_id = p_chain_id AND step_order > p_step_order
     ORDER BY step_order
  LOOP
    v_later_approver := public._resolve_step_single_approver(
      p_chain_id, v_later_step.step_order, p_applicant_emp_id
    );
    IF v_later_approver IS NOT NULL AND v_later_approver = v_cur_approver THEN
      RETURN TRUE;
    END IF;
  END LOOP;

  RETURN FALSE;
END $$;

GRANT EXECUTE ON FUNCTION public._step_approver_has_later_dup(INT, INT, INT)
  TO authenticated, service_role;


-- ═══ 3. expense_requests 觸發函式 ═══════════════════════════════════════════
-- 命名 trg_zz_* 確保在自簽跳過（trg_z_auto_skip_self_approval_*）之後執行。
-- 兩者可同一張單上同時觸發、各自補一筆 auto_skipped 紀錄，互不干擾。
CREATE OR REPLACE FUNCTION public.auto_skip_dup_approver_expense_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step        approval_chain_steps;
  v_total_steps INT;
  v_safety      INT := 0;
BEGIN
  IF NEW.approval_chain_id IS NULL OR NEW.employee_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.current_step IS NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('申請中', '待審') THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_total_steps
    FROM approval_chain_steps WHERE chain_id = NEW.approval_chain_id;
  IF v_total_steps = 0 THEN RETURN NEW; END IF;

  WHILE NEW.current_step < v_total_steps AND v_safety < 100 LOOP
    v_safety := v_safety + 1;

    IF NOT public._step_approver_has_later_dup(
        NEW.approval_chain_id, NEW.current_step, NEW.employee_id
    ) THEN
      EXIT;
    END IF;

    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = NEW.approval_chain_id AND step_order = NEW.current_step;
    IF v_step.id IS NULL THEN EXIT; END IF;

    INSERT INTO approval_step_history (
      request_type, request_id, organization_id, chain_id,
      step_order, step_label, target_type,
      entered_at, exited_at, action, approver_name, notes
    ) VALUES (
      'expense_request', NEW.id, NEW.organization_id, NEW.approval_chain_id,
      NEW.current_step, v_step.label, v_step.target_type,
      NOW(), NOW(), 'auto_skipped',
      '系統自動跳過', '此關審核人將在後續關卡重複出現'
    );

    NEW.current_step := NEW.current_step + 1;
  END LOOP;

  -- 安全閥：整條 chain 全是重複審核人（幾乎不可能，防禦用）
  IF NEW.current_step >= v_total_steps THEN
    NEW.status       := '已核准';
    NEW.current_step := v_total_steps;
    IF NEW.approved_by IS NULL OR NEW.approved_by = '' THEN
      NEW.approved_by := '系統自動跳過（重複審核人）';
    END IF;
    IF NEW.approved_at IS NULL THEN
      NEW.approved_at := NOW();
    END IF;
  END IF;

  RETURN NEW;
END $$;

GRANT EXECUTE ON FUNCTION public.auto_skip_dup_approver_expense_request()
  TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_zz_auto_skip_dup_approver_insert ON expense_requests;
CREATE TRIGGER trg_zz_auto_skip_dup_approver_insert
BEFORE INSERT ON expense_requests
FOR EACH ROW EXECUTE FUNCTION public.auto_skip_dup_approver_expense_request();

DROP TRIGGER IF EXISTS trg_zz_auto_skip_dup_approver_update ON expense_requests;
CREATE TRIGGER trg_zz_auto_skip_dup_approver_update
BEFORE UPDATE OF current_step ON expense_requests
FOR EACH ROW
WHEN (
  NEW.current_step IS DISTINCT FROM OLD.current_step
  AND NEW.status IN ('申請中', '待審')
)
EXECUTE FUNCTION public.auto_skip_dup_approver_expense_request();


-- ═══ 4. HR B 類觸發函式 ══════════════════════════════════════════════════════
-- 共用同一個函式，TG_TABLE_NAME 決定 approval_step_history.request_type。
-- HR B 表的 status 欄只有 '申請中'（不像 expense_requests 還有 '待審'）。
-- approved_at 設定；approver_id 保留 NULL（無人類審核人，由系統跳過）。
CREATE OR REPLACE FUNCTION public.auto_skip_dup_approver_hr()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step         approval_chain_steps;
  v_total_steps  INT;
  v_safety       INT := 0;
  v_request_type TEXT;
BEGIN
  IF NEW.approval_chain_id IS NULL OR NEW.employee_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.current_step IS NULL THEN RETURN NEW; END IF;
  IF NEW.status <> '申請中' THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_total_steps
    FROM approval_chain_steps WHERE chain_id = NEW.approval_chain_id;
  IF v_total_steps = 0 THEN RETURN NEW; END IF;

  v_request_type := CASE TG_TABLE_NAME
    WHEN 'resignation_requests'        THEN 'resignation'
    WHEN 'leave_of_absence_requests'   THEN 'loa'
    WHEN 'personnel_transfer_requests' THEN 'transfer'
    WHEN 'headcount_requests'          THEN 'headcount'
    ELSE TG_TABLE_NAME
  END;

  WHILE NEW.current_step < v_total_steps AND v_safety < 100 LOOP
    v_safety := v_safety + 1;

    IF NOT public._step_approver_has_later_dup(
        NEW.approval_chain_id, NEW.current_step, NEW.employee_id
    ) THEN
      EXIT;
    END IF;

    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = NEW.approval_chain_id AND step_order = NEW.current_step;
    IF v_step.id IS NULL THEN EXIT; END IF;

    INSERT INTO approval_step_history (
      request_type, request_id, organization_id, chain_id,
      step_order, step_label, target_type,
      entered_at, exited_at, action, approver_name, notes
    ) VALUES (
      v_request_type, NEW.id, NEW.organization_id, NEW.approval_chain_id,
      NEW.current_step, v_step.label, v_step.target_type,
      NOW(), NOW(), 'auto_skipped',
      '系統自動跳過', '此關審核人將在後續關卡重複出現'
    );

    NEW.current_step := NEW.current_step + 1;
  END LOOP;

  -- 安全閥
  IF NEW.current_step >= v_total_steps THEN
    NEW.status       := '已核准';
    NEW.current_step := v_total_steps;
    IF NEW.approved_at IS NULL THEN
      NEW.approved_at := NOW();
    END IF;
  END IF;

  RETURN NEW;
END $$;

GRANT EXECUTE ON FUNCTION public.auto_skip_dup_approver_hr()
  TO authenticated, service_role;


-- ─── resignation_requests ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_insert ON resignation_requests;
CREATE TRIGGER trg_z_auto_skip_dup_approver_insert
BEFORE INSERT ON resignation_requests
FOR EACH ROW EXECUTE FUNCTION public.auto_skip_dup_approver_hr();

DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_update ON resignation_requests;
CREATE TRIGGER trg_z_auto_skip_dup_approver_update
BEFORE UPDATE OF current_step ON resignation_requests
FOR EACH ROW
WHEN (NEW.current_step IS DISTINCT FROM OLD.current_step AND NEW.status = '申請中')
EXECUTE FUNCTION public.auto_skip_dup_approver_hr();


-- ─── leave_of_absence_requests ───────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_insert ON leave_of_absence_requests;
CREATE TRIGGER trg_z_auto_skip_dup_approver_insert
BEFORE INSERT ON leave_of_absence_requests
FOR EACH ROW EXECUTE FUNCTION public.auto_skip_dup_approver_hr();

DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_update ON leave_of_absence_requests;
CREATE TRIGGER trg_z_auto_skip_dup_approver_update
BEFORE UPDATE OF current_step ON leave_of_absence_requests
FOR EACH ROW
WHEN (NEW.current_step IS DISTINCT FROM OLD.current_step AND NEW.status = '申請中')
EXECUTE FUNCTION public.auto_skip_dup_approver_hr();


-- ─── personnel_transfer_requests ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_insert ON personnel_transfer_requests;
CREATE TRIGGER trg_z_auto_skip_dup_approver_insert
BEFORE INSERT ON personnel_transfer_requests
FOR EACH ROW EXECUTE FUNCTION public.auto_skip_dup_approver_hr();

DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_update ON personnel_transfer_requests;
CREATE TRIGGER trg_z_auto_skip_dup_approver_update
BEFORE UPDATE OF current_step ON personnel_transfer_requests
FOR EACH ROW
WHEN (NEW.current_step IS DISTINCT FROM OLD.current_step AND NEW.status = '申請中')
EXECUTE FUNCTION public.auto_skip_dup_approver_hr();


-- ─── headcount_requests ──────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_insert ON headcount_requests;
CREATE TRIGGER trg_z_auto_skip_dup_approver_insert
BEFORE INSERT ON headcount_requests
FOR EACH ROW EXECUTE FUNCTION public.auto_skip_dup_approver_hr();

DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_update ON headcount_requests;
CREATE TRIGGER trg_z_auto_skip_dup_approver_update
BEFORE UPDATE OF current_step ON headcount_requests
FOR EACH ROW
WHEN (NEW.current_step IS DISTINCT FROM OLD.current_step AND NEW.status = '申請中')
EXECUTE FUNCTION public.auto_skip_dup_approver_hr();


COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════
-- 驗證測試：
--
-- ① 確認兩個 helper 能正常呼叫（替換為實際 chain_id / step_order / emp_id）：
--   SELECT public._resolve_step_single_approver(<chain_id>, 0, <emp_id>);
--   SELECT public._step_approver_has_later_dup(<chain_id>, 0, <emp_id>);
--
-- ② 靜態重複（Step 0 & Step 2 都是 fixed_emp 指向同一人）：
--   建立一筆新申請單 → current_step 應直接跳到 1，
--   approval_step_history 多一筆 action='auto_skipped' 在 step_order=0。
--
-- ③ 動態重複（Step 0 = applicant_dept_manager = 部門主管 A，
--            Step 2 = fixed_emp = 員工 A）：
--   由 A 的下屬建單 → step 0 自動跳過，A 只在 step 2 簽核。
--
-- ④ 不影響正常鏈（每關都是不同人）：current_step 停在 0，不跳。
--
-- ⑤ 確認 expense_requests 觸發順序：
--   自簽跳過（trg_z_auto_skip_self_approval_*）先跑，
--   重複審核人跳過（trg_zz_auto_skip_dup_approver_*）後跑，
--   兩者各補一筆 auto_skipped，notes 文字不同可區分。
--
-- 緊急 rollback：
--   DROP TRIGGER trg_zz_auto_skip_dup_approver_insert ON expense_requests;
--   DROP TRIGGER trg_zz_auto_skip_dup_approver_update ON expense_requests;
--   DROP TRIGGER trg_z_auto_skip_dup_approver_insert ON resignation_requests;
--   DROP TRIGGER trg_z_auto_skip_dup_approver_update ON resignation_requests;
--   DROP TRIGGER trg_z_auto_skip_dup_approver_insert ON leave_of_absence_requests;
--   DROP TRIGGER trg_z_auto_skip_dup_approver_update ON leave_of_absence_requests;
--   DROP TRIGGER trg_z_auto_skip_dup_approver_insert ON personnel_transfer_requests;
--   DROP TRIGGER trg_z_auto_skip_dup_approver_update ON personnel_transfer_requests;
--   DROP TRIGGER trg_z_auto_skip_dup_approver_insert ON headcount_requests;
--   DROP TRIGGER trg_z_auto_skip_dup_approver_update ON headcount_requests;
--   DROP FUNCTION public.auto_skip_dup_approver_expense_request();
--   DROP FUNCTION public.auto_skip_dup_approver_hr();
--   DROP FUNCTION public._step_approver_has_later_dup(INT, INT, INT);
--   DROP FUNCTION public._resolve_step_single_approver(INT, INT, INT);
-- ════════════════════════════════════════════════════════════
