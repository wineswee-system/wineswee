-- ============================================================================
-- LIFF 任務跨步驟 / 未開始 task 兩個 bug 修復
-- ============================================================================
--
-- Bug A: liff_list_my_tasks 在 active scope 下顯示所有「未開始」task
--   原 filter: status NOT IN ('已完成','已取消')
--   → 流程剛發起，5 個 step task 全顯示在 LIFF（包含 step 2-5「未開始」）
--   修：active scope 排除 '未開始' / 'completed'（schema drift 英文版）
--
-- Bug B: liff_complete_task / liff_complete_task_v2 沒擋跨步驟完成
--   原邏輯：只看 status <> '已完成' → 第 3 步可直接 mark done 跳過第 2 步
--   修：屬於 workflow 的 task 完成前，先 check 同 workflow_instance_id 內
--       step_order < self 的 task 是否還有未完成 → 有就 reject
-- ============================================================================

-- ── 1. list RPC：active 排除「未開始」 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_list_my_tasks(
  p_line_user_id text,
  p_scope text DEFAULT 'active'
) RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_agg(row_to_json(t.*)
    ORDER BY
      CASE WHEN t.status IN ('已完成','已取消','completed') THEN 1 ELSE 0 END,
      t.due_date NULLS LAST,
      t.id
  ), '[]'::json)
  FROM public.tasks t
  WHERE t.assignee_id = (SELECT id FROM public._liff_resolve_employee(p_line_user_id))
    AND (
      CASE lower(COALESCE(p_scope, 'active'))
        WHEN 'all'       THEN TRUE
        WHEN 'completed' THEN t.status IN ('已完成','已取消','completed')
        -- ★ 'active' 排除「未開始」— 流程內前置步驟還沒完成的 task 不該進 LIFF
        ELSE                  t.status NOT IN ('已完成','已取消','completed','未開始')
      END
    )
$$;


-- ── 2. complete RPC v1：加步驟順序 guard ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_complete_task(
  p_line_user_id text,
  p_task_id integer
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp           employees;
  task_row      tasks;
  blocked_count int;
  n             int;
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
  IF task_row.status IN ('已完成','completed') THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_DONE');
  END IF;

  -- ★ 屬於 workflow 的 task → 檢查前置 step 是否都完成
  IF task_row.workflow_instance_id IS NOT NULL AND task_row.step_order IS NOT NULL THEN
    SELECT COUNT(*) INTO blocked_count
      FROM public.tasks
     WHERE workflow_instance_id = task_row.workflow_instance_id
       AND step_order < task_row.step_order
       AND status NOT IN ('已完成','已取消','completed');
    IF blocked_count > 0 THEN
      RETURN json_build_object(
        'ok', false,
        'error', 'PREV_STEP_NOT_DONE',
        'message', '前面步驟還有 ' || blocked_count || ' 個任務未完成，無法跳關'
      );
    END IF;
  END IF;

  UPDATE public.tasks
     SET status = '已完成',
         completed_at = now()
   WHERE id = p_task_id
     AND status NOT IN ('已完成','completed');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_DONE');
  END IF;
  RETURN json_build_object('ok', true);
END
$$;


-- ── 3. complete RPC v2：同樣加 step_order guard ────────────────────────────
CREATE OR REPLACE FUNCTION public.liff_complete_task_v2(
  p_line_user_id text,
  p_task_id integer
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp           employees;
  task_row      tasks;
  blocked_count int;
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

  -- ★ 屬於 workflow 的 task → 檢查前置 step 是否都完成
  IF task_row.workflow_instance_id IS NOT NULL AND task_row.step_order IS NOT NULL THEN
    SELECT COUNT(*) INTO blocked_count
      FROM public.tasks
     WHERE workflow_instance_id = task_row.workflow_instance_id
       AND step_order < task_row.step_order
       AND status NOT IN ('已完成','已取消','completed');
    IF blocked_count > 0 THEN
      RETURN json_build_object(
        'ok', false,
        'error', 'PREV_STEP_NOT_DONE',
        'message', '前面步驟還有 ' || blocked_count || ' 個任務未完成，無法跳關'
      );
    END IF;
  END IF;

  IF task_row.approval_chain_id IS NOT NULL THEN
    PERFORM 1 FROM task_confirmations WHERE task_id = p_task_id LIMIT 1;
    IF NOT FOUND THEN
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
END
$$;

COMMENT ON FUNCTION public.liff_list_my_tasks IS
  'LIFF 任務列表 — active scope 排除「未開始」(流程前置 step 未完成的 task 不顯示)';

COMMENT ON FUNCTION public.liff_complete_task IS
  'LIFF 完成任務 v1 — 屬 workflow 的 task 完成前 check 前置 step 都完成';

COMMENT ON FUNCTION public.liff_complete_task_v2 IS
  'LIFF 完成任務 v2 (with approval chain) — 同樣 check 前置 step';
