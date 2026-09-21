-- ════════════════════════════════════════════════════════════
-- 修 42725「function _create_task_confirmations_for_step is not unique」
-- 2026-05-14
--
-- 病灶：20260514050000_task_chain_pass_assignee.sql 用 CREATE OR REPLACE 加了
--   第 5 個參數 p_applicant_emp_id，但沒 DROP 舊 4 參數版本 →
--   DB 同時有兩個重載，4-arg caller (liff_complete_task_v2 / web_complete_task)
--   觸發歧義 → 簽核鏈整條死。
--
-- 修法：
--   1. DROP 舊 4 參數版本（修 42725 多載衝突）
--   2. liff_complete_task_v2 內部呼叫改 5-arg 並傳 emp.id（assignee 自己）
--   3. web_complete_task 內部呼叫改 5-arg 並傳 v_emp.id
--   → 動態 target_type（applicant_dept_manager 等）也能正確解人
--
-- 影響：恢復 LIFF/web 任務完成；第 2 關以後審核人能正常收 LINE
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. DROP 舊 4 參數版本 ═══
DROP FUNCTION IF EXISTS public._create_task_confirmations_for_step(integer, integer, integer, integer);

-- ═══ 2. liff_complete_task_v2 → 5-arg call ═══
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
  v_approvers   json := '[]'::json;
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

  IF task_row.approval_chain_id IS NOT NULL THEN
    PERFORM 1 FROM task_confirmations WHERE task_id = p_task_id LIMIT 1;
    IF NOT FOUND THEN
      -- ★ 5-arg：傳 emp.id 給動態 target_type（applicant_dept_manager 等）解人
      v_approvers := public._create_task_confirmations_for_step(
        p_task_id, task_row.approval_chain_id, 0, task_row.organization_id, emp.id
      );
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM task_confirmations
    WHERE task_id = p_task_id AND status = 'pending'
  ) INTO has_pending;

  IF task_row.approval_chain_id IS NOT NULL AND NOT has_pending THEN
    new_status := '已完成';
  ELSE
    new_status := CASE WHEN has_pending THEN '待確認' ELSE '已完成' END;
  END IF;

  UPDATE tasks SET
    status       = new_status,
    completed_at = CASE WHEN new_status = '已完成' THEN NOW() ELSE NULL END
  WHERE id = p_task_id;

  IF v_approvers::jsonb = '[]'::jsonb AND has_pending THEN
    SELECT COALESCE(json_agg(json_build_object(
      'emp_id', e.id, 'name', e.name,
      'line_user_id', t.line_user_id,
      'channel_code', t.channel_code
    )), '[]'::json) INTO v_approvers
      FROM task_confirmations tc
      JOIN employees e ON e.name = tc.approver
        AND (e.organization_id = task_row.organization_id OR task_row.organization_id IS NULL)
      LEFT JOIN LATERAL public._employee_line_target(e.id) t ON true
     WHERE tc.task_id = p_task_id AND tc.status = 'pending';
  END IF;

  RETURN json_build_object(
    'ok', true,
    'task_id', p_task_id,
    'status', new_status,
    'has_pending_confirmations', has_pending,
    'approvers', v_approvers,
    'task_title', task_row.title
  );
END $$;

GRANT EXECUTE ON FUNCTION public.liff_complete_task_v2(text, int) TO anon, authenticated, service_role;


-- ═══ 3. web_complete_task → 5-arg call ═══
CREATE OR REPLACE FUNCTION public.web_complete_task(
  p_task_id INT
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_emp          employees;
  v_task         tasks;
  v_has_pending  boolean;
  v_new_status   text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF v_emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_task FROM tasks
   WHERE id = p_task_id
     AND (assignee_id = v_emp.id OR assignee = v_emp.name);
  IF v_task.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_NOT_ASSIGNED');
  END IF;

  IF v_task.approval_chain_id IS NOT NULL THEN
    PERFORM 1 FROM task_confirmations WHERE task_id = p_task_id LIMIT 1;
    IF NOT FOUND THEN
      -- ★ 5-arg：傳 assignee 給動態 target_type 解人
      PERFORM public._create_task_confirmations_for_step(
        p_task_id, v_task.approval_chain_id, 0, v_task.organization_id,
        COALESCE(v_task.assignee_id, v_emp.id)
      );
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM task_confirmations
    WHERE task_id = p_task_id AND status = 'pending'
  ) INTO v_has_pending;

  IF v_task.approval_chain_id IS NOT NULL AND NOT v_has_pending THEN
    v_new_status := '已完成';
  ELSE
    v_new_status := CASE WHEN v_has_pending THEN '待確認' ELSE '已完成' END;
  END IF;

  UPDATE tasks SET
    status       = v_new_status,
    completed_at = CASE WHEN v_new_status = '已完成' THEN NOW() ELSE NULL END
  WHERE id = p_task_id;

  RETURN json_build_object(
    'ok', true,
    'task_id', p_task_id,
    'status', v_new_status,
    'has_pending_confirmations', v_has_pending,
    'task_title', v_task.title
  );
END $$;

GRANT EXECUTE ON FUNCTION public.web_complete_task(int) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 驗證：應該只剩 1 個版本 (5 參數)
SELECT pg_get_function_arguments(p.oid) AS sig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.proname = '_create_task_confirmations_for_step' AND n.nspname = 'public';
