-- ============================================================
-- 任務確認支援簽核鏈 + 完成時通知審批人
--
-- 加 task_confirmations.step_order 追 chain 第幾步
-- 升級 liff_complete_task_v2：完成時若有 chain → 解析 step 0 → 建 task_confirmations 並回傳 approvers
-- 升級 trg_sync_task_confirmation_status：chain 推進邏輯
-- ============================================================

BEGIN;

-- ═══ 1. task_confirmations.step_order ═══
ALTER TABLE public.task_confirmations
  ADD COLUMN IF NOT EXISTS step_order INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_task_conf_task_step
  ON public.task_confirmations(task_id, step_order, status);

COMMENT ON COLUMN public.task_confirmations.step_order IS
  '若 task.approval_chain_id IS NOT NULL，這欄等於 approval_chain_steps.step_order；非 chain 模式統一為 0';


-- ═══ 2. helper：把 chain step 的合法簽核者塞進 task_confirmations ═══
CREATE OR REPLACE FUNCTION public._create_task_confirmations_for_step(
  p_task_id  INT,
  p_chain_id INT,
  p_step_ord INT,
  p_org_id   INT
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_step approval_chain_steps;
  v_inserted json;
BEGIN
  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = p_chain_id AND step_order = p_step_ord;
  IF v_step.id IS NULL THEN RETURN '[]'::json; END IF;

  -- INSERT 一筆 per matching employee；UNIQUE (task_id, approver) 衝突就忽略
  WITH approvers AS (
    SELECT e.id AS emp_id, e.name AS emp_name
      FROM employees e
     WHERE e.status = '在職'
       AND (p_org_id IS NULL OR e.organization_id = p_org_id)
       AND public._employee_matches_chain_step(e.id, v_step.id)
  ), inserted AS (
    INSERT INTO task_confirmations (task_id, approver, status, step_order, organization_id)
    SELECT p_task_id, emp_name, 'pending', p_step_ord, p_org_id FROM approvers
    ON CONFLICT (task_id, approver) DO NOTHING
    RETURNING approver
  )
  SELECT COALESCE(json_agg(json_build_object(
           'emp_id', e.id,
           'name',   e.name,
           'line_user_id', e.line_user_id
         )), '[]'::json)
    INTO v_inserted
    FROM approvers a
    JOIN employees e ON e.name = a.emp_name AND (p_org_id IS NULL OR e.organization_id = p_org_id);

  RETURN v_inserted;
END $$;

GRANT EXECUTE ON FUNCTION public._create_task_confirmations_for_step(INT, INT, INT, INT) TO authenticated, anon;


-- ═══ 3. liff_complete_task_v2 升級：回傳 approvers 給 client 推 LINE ═══
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

  -- 若 task 有 approval_chain_id 且還沒有任何 task_confirmations → 解析 step 0 並建立
  IF task_row.approval_chain_id IS NOT NULL THEN
    PERFORM 1 FROM task_confirmations WHERE task_id = p_task_id LIMIT 1;
    IF NOT FOUND THEN
      v_approvers := public._create_task_confirmations_for_step(
        p_task_id, task_row.approval_chain_id, 0, task_row.organization_id
      );
    END IF;
  END IF;

  -- 撈所有 pending 審批人（含上面剛建的 + 部署時手動掛的）
  SELECT EXISTS (
    SELECT 1 FROM task_confirmations
    WHERE task_id = p_task_id AND status = 'pending'
  ) INTO has_pending;

  -- 如果是 chain 模式但 step 0 解析不出任何人 → 直接完成（避免卡死）
  IF task_row.approval_chain_id IS NOT NULL AND NOT has_pending THEN
    new_status := '已完成';
  ELSE
    new_status := CASE WHEN has_pending THEN '待確認' ELSE '已完成' END;
  END IF;

  UPDATE tasks SET
    status       = new_status,
    completed_at = CASE WHEN new_status = '已完成' THEN NOW() ELSE NULL END
  WHERE id = p_task_id;

  -- 回傳：給 client 用 line_user_id 直接推
  IF v_approvers = '[]'::json AND has_pending THEN
    SELECT COALESCE(json_agg(json_build_object(
      'emp_id', e.id, 'name', e.name, 'line_user_id', e.line_user_id
    )), '[]'::json) INTO v_approvers
      FROM task_confirmations tc
      JOIN employees e ON e.name = tc.approver
        AND (e.organization_id = task_row.organization_id OR task_row.organization_id IS NULL)
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

GRANT EXECUTE ON FUNCTION public.liff_complete_task_v2(text, int) TO authenticated, anon;


-- ═══ 4. trigger 升級：chain step 自動推進 ═══
-- 當「當前 step」的 task_confirmations 全部回應完：
--   有人 reject → task='已退回'，停止
--   全部 approve：
--     - 不是 chain → task='已完成'
--     - 是 chain 且還有下一步 → 建下一步的 task_confirmations（trigger 不會推 LINE，要 client 拉新 RPC）
--     - 是 chain 且是最後一步 → task='已完成'
CREATE OR REPLACE FUNCTION public.trg_sync_task_confirmation_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total      INT;
  v_done       INT;
  v_rejected   INT;
  v_step       INT;
  v_task       tasks;
  v_chain_total INT;
  v_is_last    BOOLEAN;
  v_new_status TEXT;
  v_new_cstatus TEXT;
BEGIN
  v_step := NEW.step_order;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status IN ('approved','rejected')),
         COUNT(*) FILTER (WHERE status = 'rejected')
    INTO v_total, v_done, v_rejected
    FROM task_confirmations
   WHERE task_id = NEW.task_id AND step_order = v_step;

  -- 當前 step 還沒簽完
  IF v_total = 0 OR v_done < v_total THEN RETURN NEW; END IF;

  SELECT * INTO v_task FROM tasks WHERE id = NEW.task_id;

  -- 有人 reject → 整個任務退回
  IF v_rejected > 0 THEN
    UPDATE tasks SET
      confirmation_status = 'rejected',
      confirmation_responded_at = NOW(),
      status = CASE WHEN status = '待確認' THEN '已退回' ELSE status END
    WHERE id = NEW.task_id;
    RETURN NEW;
  END IF;

  -- 全部 approve
  IF v_task.approval_chain_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_chain_total FROM approval_chain_steps WHERE chain_id = v_task.approval_chain_id;
    v_is_last := (v_step + 1 >= v_chain_total);
    IF NOT v_is_last THEN
      -- 推進到下一步：建下一 step 的 task_confirmations
      PERFORM public._create_task_confirmations_for_step(
        v_task.id, v_task.approval_chain_id, v_step + 1, v_task.organization_id
      );
      -- task 維持 待確認
      RETURN NEW;
    END IF;
  END IF;

  -- 沒 chain 或 是最後一步 → 完成
  v_new_cstatus := 'approved';
  v_new_status  := '已完成';
  UPDATE tasks SET
    confirmation_status = v_new_cstatus,
    confirmation_responded_at = NOW(),
    status = CASE WHEN status = '待確認' THEN v_new_status ELSE status END,
    completed_at = CASE WHEN status = '待確認' THEN NOW() ELSE completed_at END
  WHERE id = NEW.task_id;

  RETURN NEW;
END $$;


-- ═══ 5. 新 RPC：給 LIFF 任務確認頁簽完一關後拉「下一關 approvers」推 LINE ═══
CREATE OR REPLACE FUNCTION public.liff_get_task_next_approvers(
  p_line_user_id text,
  p_task_id      int
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  v_max_step INT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT MAX(step_order) INTO v_max_step
    FROM task_confirmations WHERE task_id = p_task_id;

  IF v_max_step IS NULL THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(json_build_object(
      'emp_id', e.id, 'name', e.name, 'line_user_id', e.line_user_id
    ))
    FROM task_confirmations tc
    JOIN employees e ON e.name = tc.approver
   WHERE tc.task_id = p_task_id
     AND tc.step_order = v_max_step
     AND tc.status = 'pending'
  ), '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_task_next_approvers(text, int) TO authenticated, anon;

COMMIT;
