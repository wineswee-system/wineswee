-- ════════════════════════════════════════════════════════════════════════════
-- 代理再轉手（Stage 2）
--   1. list_active_proxies()        — 列出目前還在代理中的（mode=proxy 未 reverse）
--   2. reassign_delegation(log,new)  — 把代理的所有東西從現任轉給新人（用 log 記的 id）
--   3. convert_proxy_to_transfer(log) — 代理轉正式交接（以後不再轉手）
--
-- 不動簽核解析核心：靠 employee_delegate_log 記下的 record id 精準轉移。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 列出目前代理中 ──
CREATE OR REPLACE FUNCTION public.list_active_proxies()
RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::json)
  FROM (
    SELECT l.id AS log_id,
           l.original_emp_id, eo.name AS original_name,
           l.delegate_emp_id, ed.name AS delegate_name,
           l.created_at,
           (COALESCE(array_length(l.chain_step_ids,1),0)
            + COALESCE(array_length(l.snapshot_ids,1),0)
            + COALESCE(array_length(l.store_ids,1),0)
            + COALESCE(array_length(l.dept_ids,1),0)
            + COALESCE(array_length(l.section_ids,1),0)
            + COALESCE(array_length(l.extra_step_ids,1),0)
            + COALESCE(array_length(l.task_ids,1),0)
            + COALESCE(array_length(l.subordinate_ids,1),0)) AS item_count
    FROM employee_delegate_log l
    JOIN employees eo ON eo.id = l.original_emp_id
    JOIN employees ed ON ed.id = l.delegate_emp_id
    WHERE l.mode = 'proxy' AND l.is_reversed = false
  ) r
$$;
GRANT EXECUTE ON FUNCTION public.list_active_proxies() TO authenticated, service_role;


-- ── 2. 再轉手 ──
CREATE OR REPLACE FUNCTION public.reassign_delegation(
  p_log_id   INT,
  p_new_emp  INT,
  p_actor    INT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  l        employee_delegate_log;
  v_new    employees;
  v_newlog INT;
BEGIN
  SELECT * INTO l FROM employee_delegate_log WHERE id = p_log_id;
  IF l.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'LOG_NOT_FOUND'); END IF;
  IF l.mode <> 'proxy' OR l.is_reversed THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_ACTIVE_PROXY');
  END IF;
  IF p_new_emp = l.delegate_emp_id THEN RETURN json_build_object('ok', false, 'error', 'SAME_AS_CURRENT'); END IF;
  SELECT * INTO v_new FROM employees WHERE id = p_new_emp AND status = '在職';
  IF v_new.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NEW_DELEGATE_NOT_ACTIVE'); END IF;

  -- 用 log 記的 id 精準轉移（從現任 → 新人）
  IF array_length(l.chain_step_ids,1)  > 0 THEN UPDATE approval_chain_steps      SET target_emp_id = p_new_emp WHERE id = ANY(l.chain_step_ids); END IF;
  IF array_length(l.snapshot_ids,1)    > 0 THEN UPDATE request_chain_snapshots   SET target_emp_id = p_new_emp WHERE id = ANY(l.snapshot_ids); END IF;
  IF array_length(l.store_ids,1)       > 0 THEN UPDATE stores                     SET manager_id    = p_new_emp WHERE id = ANY(l.store_ids); END IF;
  IF array_length(l.dept_ids,1)        > 0 THEN UPDATE departments               SET manager_id    = p_new_emp WHERE id = ANY(l.dept_ids); END IF;
  IF array_length(l.section_ids,1)     > 0 THEN UPDATE department_sections        SET supervisor_id = p_new_emp WHERE id = ANY(l.section_ids); END IF;
  IF array_length(l.extra_step_ids,1)  > 0 THEN UPDATE approval_extra_steps       SET assignee_id   = p_new_emp WHERE id = ANY(l.extra_step_ids) AND status = 'pending'; END IF;
  IF array_length(l.task_ids,1)        > 0 THEN UPDATE tasks                       SET assignee_id   = p_new_emp WHERE id = ANY(l.task_ids) AND status IN ('進行中','待簽核','待確認'); END IF;
  IF array_length(l.subordinate_ids,1) > 0 THEN
    UPDATE employees SET supervisor_id = p_new_emp WHERE id = ANY(l.subordinate_ids) AND supervisor_id = l.delegate_emp_id;
    UPDATE employees SET reporting_to  = p_new_emp WHERE id = ANY(l.subordinate_ids) AND reporting_to  = l.delegate_emp_id;
  END IF;

  -- 舊 log 標記已轉手，新增一筆接續（沿用同一批 id，原始離職者不變）
  UPDATE employee_delegate_log
     SET is_reversed = true, reversed_at = NOW(), reversed_by_emp_id = p_actor
   WHERE id = p_log_id;

  INSERT INTO employee_delegate_log (
    original_emp_id, delegate_emp_id, trigger_action, mode,
    chain_step_ids, snapshot_ids, store_ids, dept_ids,
    section_ids, extra_step_ids, task_ids, subordinate_ids,
    authorized_by_emp_id, notes
  ) VALUES (
    l.original_emp_id, p_new_emp, l.trigger_action, 'proxy',
    l.chain_step_ids, l.snapshot_ids, l.store_ids, l.dept_ids,
    l.section_ids, l.extra_step_ids, l.task_ids, l.subordinate_ids,
    p_actor, '由代理再轉手（前任 log #' || p_log_id || '）'
  ) RETURNING id INTO v_newlog;

  INSERT INTO audit_logs (action, target, target_table, target_id, new_value)
  VALUES ('proxy_reassign', v_new.name, 'employee_delegate_log', v_newlog,
          'proxy 從 log#' || p_log_id || ' 轉手給 ' || v_new.name);

  RETURN json_build_object('ok', true, 'new_log_id', v_newlog);
END $$;
GRANT EXECUTE ON FUNCTION public.reassign_delegation(INT, INT, INT) TO authenticated, service_role;


-- ── 3. 代理轉正式交接 ──
CREATE OR REPLACE FUNCTION public.convert_proxy_to_transfer(
  p_log_id INT,
  p_actor  INT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE l employee_delegate_log;
BEGIN
  SELECT * INTO l FROM employee_delegate_log WHERE id = p_log_id;
  IF l.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'LOG_NOT_FOUND'); END IF;
  IF l.mode <> 'proxy' OR l.is_reversed THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_ACTIVE_PROXY');
  END IF;
  -- 記錄已指向現任代理人，改 mode 即可（以後不再列入可轉手）
  UPDATE employee_delegate_log SET mode = 'transfer', notes = COALESCE(notes,'') || ' [已轉正式交接]'
   WHERE id = p_log_id;
  INSERT INTO audit_logs (action, target, target_table, target_id, new_value)
  VALUES ('proxy_to_transfer', NULL, 'employee_delegate_log', p_log_id, 'log#' || p_log_id || ' 代理轉正式交接');
  RETURN json_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.convert_proxy_to_transfer(INT, INT) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
