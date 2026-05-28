-- ============================================================
-- 診斷：費用申請 #133 的 chain 有沒有在 store_id 搬遷時抓錯部門
-- ============================================================

-- ① 林巧玉現在的部門（應該是加盟展店事業部）
SELECT name, dept, department_id, store_id
FROM employees
WHERE name = '林巧玉';

-- ② 這筆申請本身記錄的 dept（建單時快照）
SELECT id, status, dept, department_id, current_step, employee_id,
       created_at
FROM expense_requests
WHERE id = 133;

-- ③ 簽核鏈各關設定
SELECT step_order, approver_id, approver_name, action, created_at, exited_at
FROM approval_step_history
WHERE request_type = 'expense_request'
  AND request_id = 133
ORDER BY step_order;

-- ④ 「加盟展店事業部」費用申請應有的 chain 長什麼樣子
SELECT ac.id, ac.name, ac.request_type, ac.department_id,
       d.name AS dept_name,
       (SELECT jsonb_agg(cs.* ORDER BY cs.step_order)
        FROM chain_steps cs WHERE cs.chain_id = ac.id) AS steps
FROM approval_chains ac
LEFT JOIN departments d ON d.id = ac.department_id
WHERE ac.request_type IN ('expense_request','expense')
ORDER BY ac.id;
