-- ════════════════════════════════════════════════════════════════════════════
-- 診斷 expense_request #186 為何「上層主管」name 解不出來
-- + 確認用的是哪條 chain（看是否對應費用簽核）
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 段 1：費用單本體 + 對應 chain ─── (圈這段 Run)
SELECT
  er.id, er.employee, er.employee_id, er.subject, er.amount,
  er.status, er.current_step,
  er.approval_chain_id,
  ac.name AS "chain名稱",
  ac.applies_to AS "chain適用類型"
FROM expense_requests er
LEFT JOIN approval_chains ac ON ac.id = er.approval_chain_id
WHERE er.id = 186;


-- ─── 段 2：chain 各 step 內容 ─── (圈這段 Run)
SELECT
  s.step_order, s.label, s.role_name,
  s.target_type, s.target_emp_id, s.target_role_id,
  s.target_dept_id, s.target_store_id, s.target_section_id
FROM approval_chain_steps s
WHERE s.chain_id = (SELECT approval_chain_id FROM expense_requests WHERE id = 186)
ORDER BY s.step_order;


-- ─── 段 3：申請人 黃蘊珊 的部門/主管設定 ─── (圈這段 Run)
SELECT
  e.id, e.name, e.employee_number, e.position,
  e.department_id, d.name AS "部門名",
  d.manager_id AS "部門主管ID",
  m.name AS "部門主管名",
  e.store_id, st.name AS "門市名"
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
LEFT JOIN employees m ON m.id = d.manager_id
LEFT JOIN stores st ON st.id = e.store_id
WHERE e.id = (SELECT employee_id FROM expense_requests WHERE id = 186);


-- ─── 段 4：用 RPC 試解第 1 關（上層主管）的實際名字 ─── (圈這段 Run)
SELECT
  s.step_order, s.label, s.target_type,
  public._chain_step_display_names(s.id, er.employee_id) AS "RPC解出的名字",
  (
    SELECT json_agg(json_build_object('emp_id', emp_id, 'emp_name', emp_name))
    FROM public.resolve_chain_step_approvers(s.id, er.employee_id)
  ) AS "RPC回的人清單"
FROM approval_chain_steps s
JOIN expense_requests er ON er.id = 186
WHERE s.chain_id = er.approval_chain_id
ORDER BY s.step_order;


-- ─── 段 5：chain snapshot 有沒有寫進去（新單應該有）─── (圈這段 Run)
SELECT step_order, label, role_name, target_type, target_emp_id, created_at
  FROM request_chain_snapshots
 WHERE request_type = 'expense_request' AND request_id = 186
 ORDER BY step_order;
