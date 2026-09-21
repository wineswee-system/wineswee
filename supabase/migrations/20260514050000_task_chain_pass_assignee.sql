-- ════════════════════════════════════════════════════════════
-- task chain 推進下一關時傳 assignee_id 給 chain step 解析器
-- 2026-05-14
--
-- 問題：簽核鏈第 1 關 OK 通過後，第 2 關沒收到 LINE。
--
-- 原因：_create_task_confirmations_for_step 呼叫 _employee_matches_chain_step
--       時沒傳第 3 個參數 p_applicant_emp_id，預設 NULL。
--       對於動態 target_type（applicant_dept_manager / store_manager / section_supervisor）
--       無法解出對應的「申請人組織圖上的人」→ 找不到 approver → INSERT 0 筆。
--
-- 修法：
--   1. _create_task_confirmations_for_step 加 p_applicant_emp_id 參數
--   2. 兩個 caller 都改傳 v_task.assignee_id 進來
--      - _task_intercept_complete_for_chain
--      - trg_sync_task_confirmation_status
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. _create_task_confirmations_for_step 加 applicant_emp_id 參數 ═══
CREATE OR REPLACE FUNCTION public._create_task_confirmations_for_step(
  p_task_id integer,
  p_chain_id integer,
  p_step_ord integer,
  p_org_id integer,
  p_applicant_emp_id integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step approval_chain_steps;
  v_inserted json;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = p_chain_id AND step_order = p_step_ord;
  IF v_step.id IS NULL THEN RETURN '[]'::json; END IF;

  WITH approvers AS (
    SELECT e.id AS emp_id, e.name AS emp_name
      FROM employees e
     WHERE e.status = '在職'
       AND (p_org_id IS NULL OR e.organization_id = p_org_id)
       -- ★ 傳 applicant_emp_id 讓動態 target（applicant_dept_manager 等）能解
       AND public._employee_matches_chain_step(e.id, v_step.id, p_applicant_emp_id)
  ), inserted AS (
    INSERT INTO task_confirmations (task_id, approver, status, step_order, organization_id)
    SELECT p_task_id, emp_name, 'pending', p_step_ord, p_org_id FROM approvers
    ON CONFLICT (task_id, approver) DO NOTHING
    RETURNING approver
  )
  SELECT COALESCE(json_agg(json_build_object(
           'emp_id',       e.id,
           'name',         e.name,
           'line_user_id', t.line_user_id,
           'channel_code', t.channel_code
         )), '[]'::json)
    INTO v_inserted
    FROM approvers a
    JOIN employees e ON e.name = a.emp_name AND (p_org_id IS NULL OR e.organization_id = p_org_id)
    LEFT JOIN LATERAL public._employee_line_target(e.id) t ON true;

  RETURN v_inserted;
END $function$;

-- ═══ 2. _task_intercept_complete_for_chain 改傳 assignee_id ═══
CREATE OR REPLACE FUNCTION public._task_intercept_complete_for_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_count int;
BEGIN
  IF NEW.status = '已完成'
     AND (OLD.status IS DISTINCT FROM '已完成')
     AND NEW.approval_chain_id IS NOT NULL THEN

    SELECT COUNT(*) INTO v_existing_count
      FROM task_confirmations
     WHERE task_id = NEW.id;

    IF v_existing_count = 0 THEN
      -- ★ 傳 NEW.assignee_id 給 chain step 解析（動態 target 才解得到）
      PERFORM public._create_task_confirmations_for_step(
        NEW.id, NEW.approval_chain_id, 0, NEW.organization_id, NEW.assignee_id
      );

      SELECT COUNT(*) INTO v_existing_count
        FROM task_confirmations
       WHERE task_id = NEW.id;

      IF v_existing_count > 0 THEN
        NEW.status := '待確認';
        NEW.completed_at := NULL;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

-- ═══ 3. trg_sync_task_confirmation_status 改傳 assignee_id ═══
CREATE OR REPLACE FUNCTION public.trg_sync_task_confirmation_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total       INT;
  v_done        INT;
  v_rejected    INT;
  v_step        INT;
  v_task        tasks;
  v_chain_total INT;
  v_is_last     BOOLEAN;
  v_assignee_line text;
  v_assignee_liff text;
BEGIN
  v_step := NEW.step_order;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status IN ('approved','rejected')),
         COUNT(*) FILTER (WHERE status = 'rejected')
    INTO v_total, v_done, v_rejected
    FROM task_confirmations
   WHERE task_id = NEW.task_id AND step_order = v_step;

  IF v_total = 0 OR v_done < v_total THEN RETURN NEW; END IF;

  SELECT * INTO v_task FROM tasks WHERE id = NEW.task_id;

  -- 解任務負責人 LINE
  SELECT v.line_user_id, v.liff_id
    INTO v_assignee_line, v_assignee_liff
    FROM v_employee_line_resolved v
   WHERE (v_task.assignee_id IS NOT NULL AND v.employee_id = v_task.assignee_id)
      OR (v_task.assignee_id IS NULL     AND v.employee_name = v_task.assignee)
   ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
   LIMIT 1;

  IF v_rejected > 0 THEN
    UPDATE tasks SET
      confirmation_status = 'rejected',
      confirmation_responded_at = NOW(),
      status = CASE WHEN status = '待確認' THEN '已退回' ELSE status END
    WHERE id = NEW.task_id;

    PERFORM public._push_task_chain_flex(
      v_assignee_line, v_assignee_liff, v_task.id, v_task.title,
      NULL, NULL, NULL, 'task_rejected'
    );
    RETURN NEW;
  END IF;

  IF v_task.approval_chain_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_chain_total FROM approval_chain_steps WHERE chain_id = v_task.approval_chain_id;
    v_is_last := (v_step + 1 >= v_chain_total);
    IF NOT v_is_last THEN
      -- ★ 傳 assignee_id 給 chain step 解析（動態 target 必要）
      PERFORM public._create_task_confirmations_for_step(
        v_task.id, v_task.approval_chain_id, v_step + 1, v_task.organization_id,
        v_task.assignee_id
      );
      RETURN NEW;
    END IF;
  END IF;

  UPDATE tasks SET
    confirmation_status = 'approved',
    confirmation_responded_at = NOW(),
    status       = CASE WHEN status = '待確認' THEN '已完成' ELSE status END,
    completed_at = CASE WHEN status = '待確認' THEN NOW() ELSE completed_at END
  WHERE id = NEW.task_id;

  PERFORM public._push_task_chain_flex(
    v_assignee_line, v_assignee_liff, v_task.id, v_task.title,
    NULL, NULL, NULL, 'task_done'
  );

  RETURN NEW;
END $function$;

COMMIT;

-- 驗證
SELECT pg_get_function_arguments(p.oid) AS sig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.proname = '_create_task_confirmations_for_step' AND n.nspname = 'public';
