-- 診斷：掃全系統 chain，找出可能被 (task_id,approver) unique bug 影響的 chain + stuck tasks
BEGIN;

CREATE OR REPLACE FUNCTION public._debug_all_chains()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_build_object(
    -- 1. chain 設定面：每個 chain 各 step 解出的 approver，找出「同人重複」的
    'chains_with_duplicate_approvers', (
      WITH chain_step_emps AS (
        SELECT
          s.chain_id,
          s.id AS step_id,
          s.step_order,
          s.label,
          s.target_type,
          -- 靜態解（不帶 applicant 上下文）：對 fixed_emp/role/department 有效，動態 target 拿 NULL
          (SELECT e.id FROM employees e
            WHERE e.status = '在職'
              AND public._employee_matches_chain_step(e.id, s.id, NULL)
            LIMIT 1) AS sample_emp_id_static
          FROM approval_chain_steps s
      )
      SELECT json_agg(row_to_json(d) ORDER BY d.chain_id, d.step_order)
        FROM (
          SELECT
            c.id AS chain_id,
            c.name AS chain_name,
            cs.step_order,
            cs.label,
            cs.target_type,
            cs.sample_emp_id_static,
            e.name AS sample_emp_name,
            -- 同 chain 內有沒有別的 step 跟我同人
            (SELECT COUNT(*) FROM chain_step_emps x
              WHERE x.chain_id = cs.chain_id
                AND x.step_id <> cs.step_id
                AND x.sample_emp_id_static IS NOT NULL
                AND x.sample_emp_id_static = cs.sample_emp_id_static) AS duplicate_count
            FROM chain_step_emps cs
            JOIN approval_chains c ON c.id = cs.chain_id
            LEFT JOIN employees e ON e.id = cs.sample_emp_id_static
           WHERE cs.sample_emp_id_static IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM chain_step_emps y
                WHERE y.chain_id = cs.chain_id
                  AND y.step_id <> cs.step_id
                  AND y.sample_emp_id_static = cs.sample_emp_id_static
             )
        ) d
    ),

    -- 2. 任務狀態面：目前所有 status='待確認' 且有 chain 的 task，看停在哪一步
    'stuck_chain_tasks', (
      SELECT json_agg(row_to_json(t) ORDER BY t.id DESC)
        FROM (
          SELECT
            t.id, t.title, t.status, t.approval_chain_id,
            t.assignee_id, t.organization_id, t.updated_at,
            (SELECT COUNT(*) FROM approval_chain_steps WHERE chain_id = t.approval_chain_id) AS chain_total,
            (SELECT MAX(step_order) FROM task_confirmations WHERE task_id = t.id) AS max_step_built,
            (SELECT COUNT(*) FROM task_confirmations
              WHERE task_id = t.id AND status = 'pending') AS pending_count,
            (SELECT json_agg(json_build_object(
              'step_order', step_order, 'approver', approver, 'status', status
            ) ORDER BY step_order, id)
              FROM task_confirmations WHERE task_id = t.id) AS confirmations
            FROM tasks t
           WHERE t.status = '待確認' AND t.approval_chain_id IS NOT NULL
           ORDER BY t.id DESC
           LIMIT 50
        ) t
    ),

    -- 3. 全 chain 總覽（一行/chain）：用了哪些 target_type、共幾步、有沒有重複人
    'chain_overview', (
      SELECT json_agg(row_to_json(c) ORDER BY c.id)
        FROM (
          SELECT
            c.id, c.name,
            (SELECT COUNT(*) FROM approval_chain_steps WHERE chain_id = c.id) AS step_count,
            (SELECT array_agg(DISTINCT target_type) FROM approval_chain_steps WHERE chain_id = c.id) AS target_types,
            (SELECT array_agg(label ORDER BY step_order) FROM approval_chain_steps WHERE chain_id = c.id) AS labels
            FROM approval_chains c
           ORDER BY c.id
        ) c
    )
  ) INTO v_result;
  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public._debug_all_chains() TO authenticated, anon, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
