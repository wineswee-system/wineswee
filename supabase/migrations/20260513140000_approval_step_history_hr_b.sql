-- ════════════════════════════════════════════════════════════
-- 擴充簽核時間軸 audit 涵蓋 HR B 類（離職/留停/調職）
-- 2026-05-13
--
-- 5/13 的 20260513090000_approval_step_history.sql 只掛 HR A 類 6 表：
--   leave_requests / overtime_requests / business_trips /
--   clock_corrections / expenses / expense_requests
--
-- HR B 類（resignation_requests / leave_of_absence_requests /
--          personnel_transfer_requests）也走 chain，但用 hr_chain_approve RPC
--   推進；漏了時間軸記錄。這裡補上。
--
-- 變更：
--   1. trg_log_approval_step_history function 加 HR B 類 request_type map
--   2. 把 trigger 掛到 3 個 B 類表
--   3. _ash_get_request_meta + get_approval_timeline 已用 dynamic table name
--      解析，加 case 即可
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 擴充 trg_log_approval_step_history 涵蓋 HR B 類 ═══
CREATE OR REPLACE FUNCTION public.trg_log_approval_step_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rt          TEXT;
  v_step_label  TEXT;
  v_target_type TEXT;
  v_action      TEXT;
BEGIN
  v_rt := CASE TG_TABLE_NAME
    WHEN 'leave_requests'              THEN 'leave'
    WHEN 'overtime_requests'           THEN 'overtime'
    WHEN 'business_trips'              THEN 'trip'
    WHEN 'clock_corrections'           THEN 'correction'
    WHEN 'expenses'                    THEN 'expense'
    WHEN 'expense_requests'            THEN 'expense_request'
    WHEN 'resignation_requests'        THEN 'resignation'
    WHEN 'leave_of_absence_requests'   THEN 'loa'
    WHEN 'personnel_transfer_requests' THEN 'transfer'
    ELSE NULL
  END;
  IF v_rt IS NULL THEN RETURN NEW; END IF;

  -- INSERT：起手寫第一筆 entered
  IF TG_OP = 'INSERT' AND NEW.approval_chain_id IS NOT NULL THEN
    SELECT label, target_type INTO v_step_label, v_target_type
      FROM approval_chain_steps
     WHERE chain_id = NEW.approval_chain_id
       AND step_order = COALESCE(NEW.current_step, 0)
     LIMIT 1;

    INSERT INTO approval_step_history (
      request_type, request_id, organization_id, chain_id,
      step_order, step_label, target_type, entered_at, action
    ) VALUES (
      v_rt, NEW.id, NEW.organization_id, NEW.approval_chain_id,
      COALESCE(NEW.current_step, 0), v_step_label, v_target_type,
      now(), 'submitted'
    );
    RETURN NEW;
  END IF;

  -- UPDATE OF current_step：上一關 exit + 新關 entered
  IF TG_OP = 'UPDATE' AND NEW.current_step IS DISTINCT FROM OLD.current_step
     AND NEW.approval_chain_id IS NOT NULL THEN
    UPDATE approval_step_history
       SET exited_at = now(),
           action = CASE
             WHEN NEW.status IN ('已退回','已駁回') THEN 'rejected'
             ELSE 'approved'
           END,
           approver_name = COALESCE(NEW.approver, NEW.approved_by, approver_name)
     WHERE request_type = v_rt
       AND request_id = NEW.id
       AND step_order = OLD.current_step
       AND exited_at IS NULL;

    SELECT label, target_type INTO v_step_label, v_target_type
      FROM approval_chain_steps
     WHERE chain_id = NEW.approval_chain_id
       AND step_order = NEW.current_step
     LIMIT 1;

    IF v_step_label IS NOT NULL THEN
      INSERT INTO approval_step_history (
        request_type, request_id, organization_id, chain_id,
        step_order, step_label, target_type, entered_at, action
      ) VALUES (
        v_rt, NEW.id, NEW.organization_id, NEW.approval_chain_id,
        NEW.current_step, v_step_label, v_target_type,
        now(), 'pending'
      );
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE OF status：終態（核准/駁回）關 exit
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('已核准','已核銷','已退回','已駁回','已拒絕') THEN
    v_action := CASE NEW.status
      WHEN '已核准' THEN 'approved'
      WHEN '已核銷' THEN 'approved'
      WHEN '已退回' THEN 'rejected'
      WHEN '已駁回' THEN 'rejected'
      WHEN '已拒絕' THEN 'rejected'
    END;
    UPDATE approval_step_history
       SET exited_at = now(),
           action = v_action,
           approver_name = COALESCE(NEW.approver, NEW.approved_by, approver_name)
     WHERE request_type = v_rt
       AND request_id = NEW.id
       AND exited_at IS NULL;
  END IF;

  RETURN NEW;
END $$;


-- ═══ 2. 把 trigger 掛到 HR B 類 3 個表 ═══
DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'resignation_requests','leave_of_absence_requests','personnel_transfer_requests'
  ]
  LOOP
    -- 防禦：若表不存在跳過
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = v_table
    ) THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.%I;
         CREATE TRIGGER trg_log_approval_step_history
           AFTER INSERT OR UPDATE OF current_step, status
           ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.trg_log_approval_step_history();',
        v_table, v_table
      );
    END IF;
  END LOOP;
END $$;


-- ═══ 3. _ash_get_request_meta 補 HR B 類 case ═══
CREATE OR REPLACE FUNCTION public._ash_get_request_meta(
  p_request_type TEXT,
  p_request_id   INT
) RETURNS TABLE (
  chain_id        INT,
  current_step    INT,
  status          TEXT,
  organization_id INT,
  applicant_id    INT,
  applicant_name  TEXT,
  approver_name   TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table TEXT;
BEGIN
  v_table := CASE p_request_type
    WHEN 'leave'           THEN 'leave_requests'
    WHEN 'overtime'        THEN 'overtime_requests'
    WHEN 'trip'            THEN 'business_trips'
    WHEN 'correction'      THEN 'clock_corrections'
    WHEN 'expense'         THEN 'expenses'
    WHEN 'expense_request' THEN 'expense_requests'
    WHEN 'resignation'     THEN 'resignation_requests'
    WHEN 'loa'             THEN 'leave_of_absence_requests'
    WHEN 'transfer'        THEN 'personnel_transfer_requests'
  END;
  IF v_table IS NULL THEN RETURN; END IF;

  IF p_request_type IN ('leave','overtime') THEN
    RETURN QUERY EXECUTE format(
      'SELECT approval_chain_id, current_step, status, organization_id, employee_id, employee, approver FROM %I WHERE id=$1',
      v_table
    ) USING p_request_id;
  ELSIF p_request_type IN ('resignation','loa','transfer') THEN
    -- B 類用 employee_id 跟 approver_id（不一定有 approver name 欄位）
    RETURN QUERY EXECUTE format(
      'SELECT approval_chain_id, current_step, status, organization_id, employee_id,
              (SELECT name FROM employees WHERE id = r.employee_id) AS applicant_name,
              (SELECT name FROM employees WHERE id = r.approver_id) AS approver_name
         FROM %I r WHERE id=$1',
      v_table
    ) USING p_request_id;
  ELSE
    RETURN QUERY EXECUTE format(
      'SELECT approval_chain_id, current_step, status, organization_id, NULL::INT, employee, COALESCE(approver, approved_by) FROM %I WHERE id=$1',
      v_table
    ) USING p_request_id;
  END IF;
END $$;


-- ═══ 4. 同時把 log_task_activity 改 SECURITY DEFINER（順手解掉刪除流程 bug）═══
ALTER FUNCTION public.log_task_activity() SECURITY DEFINER;


COMMIT;

NOTIFY pgrst, 'reload schema';

-- 驗證：
-- SELECT tgname, tgrelid::regclass FROM pg_trigger
--  WHERE tgname = 'trg_log_approval_step_history';
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'log_task_activity';
