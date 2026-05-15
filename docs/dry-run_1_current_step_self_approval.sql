-- ════════════════════════════════════════════════════════════
-- DRY RUN ① 當下這一關就會自簽的單（在飛中）
--
-- 用法：Supabase Studio SQL Editor 貼進去跑
-- 不會動任何資料
--
-- 期待結果：看有幾筆，哪些表、哪些申請人
-- ════════════════════════════════════════════════════════════

WITH in_flight AS (
  SELECT 'expense_requests'::text AS tbl, id, employee_id AS applicant_id,
         approval_chain_id, current_step, created_at
    FROM expense_requests
   WHERE status = '申請中' AND approval_chain_id IS NOT NULL
  UNION ALL
  SELECT 'resignation_requests', id, employee_id, approval_chain_id, current_step, created_at
    FROM resignation_requests WHERE status = '申請中' AND approval_chain_id IS NOT NULL
  UNION ALL
  SELECT 'leave_of_absence_requests', id, employee_id, approval_chain_id, current_step, created_at
    FROM leave_of_absence_requests WHERE status = '申請中' AND approval_chain_id IS NOT NULL
  UNION ALL
  SELECT 'personnel_transfer_requests', id, employee_id, approval_chain_id, current_step, created_at
    FROM personnel_transfer_requests WHERE status = '申請中' AND approval_chain_id IS NOT NULL
  UNION ALL
  SELECT 'leave_requests', id, employee_id, approval_chain_id, current_step, created_at
    FROM leave_requests WHERE status = '待審核' AND approval_chain_id IS NOT NULL
  UNION ALL
  SELECT 'overtime_requests', id, employee_id, approval_chain_id, current_step, created_at
    FROM overtime_requests WHERE status = '待審核' AND approval_chain_id IS NOT NULL
)
SELECT
  i.tbl                                  AS "表",
  i.id                                   AS "單號",
  e.name                                 AS "申請人",
  e.position                             AS "職稱",
  d.name                                 AS "部門",
  i.current_step                         AS "當前關 (0-idx)",
  cs.label                               AS "關卡 label",
  cs.target_type                         AS "解析類型",
  to_char(i.created_at, 'YYYY-MM-DD HH24:MI') AS "送出時間"
FROM in_flight i
JOIN employees e          ON e.id = i.applicant_id
LEFT JOIN departments d   ON d.id = e.department_id
JOIN approval_chain_steps cs
  ON cs.chain_id = i.approval_chain_id AND cs.step_order = i.current_step
WHERE public._employee_matches_chain_step(i.applicant_id, cs.id, i.applicant_id) = TRUE
ORDER BY i.tbl, i.created_at DESC;
