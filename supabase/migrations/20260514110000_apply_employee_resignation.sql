-- ════════════════════════════════════════════════════════════
-- 離職統一處理 RPC + 三方入口都呼這支
-- 2026-05-14
--
-- 問題：員工管理「離職」按鈕、離職申請核准 trigger、資遣計算 三個入口
--   各做各的 cascade（甚至資遣根本沒 cascade），員工 status 沒同步、
--   組織圖沒消失、未來班表沒清。
--
-- 修法：
--   1. employees 加 resign_type 欄位區分 自願/資遣/退休/合約到期
--      （status 統一寫「離職」，不再分多個 enum）
--   2. 寫 apply_employee_resignation RPC 一次做完所有 cascade
--   3. trg_resignation_apply_on_approve trigger 改呼 RPC
--   4. 前端 Employees.handleResign / Severance.handleSave 也改呼 RPC（另 commit）
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 加 resign_type 欄位 ═══
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS resign_type TEXT;

COMMENT ON COLUMN public.employees.resign_type IS
  'voluntary=自願離職 / involuntary=資遣 / retirement=退休 / contract_end=合約到期';


-- ═══ 2. 統一離職處理 RPC ═══
CREATE OR REPLACE FUNCTION public.apply_employee_resignation(
  p_emp_id        INT,
  p_resign_date   DATE,
  p_resign_reason TEXT DEFAULT NULL,
  p_resign_type   TEXT DEFAULT 'voluntary'
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp           employees;
  v_cancelled_lv  INT;
  v_cancelled_ot  INT;
  v_cancelled_cc  INT;
  v_cancelled_bt  INT;
  v_held_tasks    INT;
  v_deleted_sched INT;
BEGIN
  -- 0. 檢查
  SELECT * INTO v_emp FROM employees WHERE id = p_emp_id;
  IF v_emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_resign_type NOT IN ('voluntary','involuntary','retirement','contract_end') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_RESIGN_TYPE',
      'received', p_resign_type);
  END IF;

  -- 1. 更新員工本人
  UPDATE employees SET
    status        = '離職',
    resign_date   = p_resign_date,
    resign_reason = p_resign_reason,
    resign_type   = p_resign_type
  WHERE id = p_emp_id;

  -- 2. 關閉 active 主要 assignment
  UPDATE employee_assignments SET
    end_date  = p_resign_date,
    is_active = false
  WHERE employee_id = p_emp_id
    AND department_type = '主要'
    AND is_active = true;

  -- 3. 刪除離職日之後的班表
  DELETE FROM schedules
   WHERE employee_id = p_emp_id
     AND date > p_resign_date;
  GET DIAGNOSTICS v_deleted_sched = ROW_COUNT;

  -- 4. 取消待審核的 HR 表單（避免遺留）
  UPDATE leave_requests SET status = '已取消'
   WHERE employee_id = p_emp_id AND status = '待審核';
  GET DIAGNOSTICS v_cancelled_lv = ROW_COUNT;

  UPDATE overtime_requests SET status = '已取消'
   WHERE employee_id = p_emp_id AND status = '待審核';
  GET DIAGNOSTICS v_cancelled_ot = ROW_COUNT;

  -- clock_corrections / business_trips 用 employee (name) join
  UPDATE clock_corrections SET status = '已取消'
   WHERE employee = v_emp.name AND status = '待審核';
  GET DIAGNOSTICS v_cancelled_cc = ROW_COUNT;

  UPDATE business_trips SET status = '已取消'
   WHERE employee = v_emp.name AND status = '待審核';
  GET DIAGNOSTICS v_cancelled_bt = ROW_COUNT;

  -- 5. 把名下未完成的 task 設「已擱置」
  --    用今天才修對齊的 status set: 進行中/待簽核/待確認
  UPDATE tasks SET status = '已擱置'
   WHERE assignee_id = p_emp_id
     AND status IN ('進行中','待簽核','待確認');
  GET DIAGNOSTICS v_held_tasks = ROW_COUNT;

  RETURN json_build_object(
    'ok', true,
    'employee_id', p_emp_id,
    'resign_date', p_resign_date,
    'resign_type', p_resign_type,
    'cascade', json_build_object(
      'deleted_future_schedules', v_deleted_sched,
      'cancelled_leave_requests', v_cancelled_lv,
      'cancelled_overtime_requests', v_cancelled_ot,
      'cancelled_clock_corrections', v_cancelled_cc,
      'cancelled_business_trips', v_cancelled_bt,
      'held_tasks', v_held_tasks
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.apply_employee_resignation(INT, DATE, TEXT, TEXT)
  TO authenticated, service_role;


-- ═══ 3. trigger 改呼 RPC（離職申請核准 path）═══
CREATE OR REPLACE FUNCTION public.trg_resignation_apply_on_approve()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = '已核准' AND (OLD.status IS DISTINCT FROM '已核准') THEN
    PERFORM public.apply_employee_resignation(
      NEW.employee_id,
      NEW.planned_resign_date,
      NEW.reason || COALESCE('（' || NEW.reason_detail || '）', ''),
      'voluntary'
    );
  END IF;
  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
