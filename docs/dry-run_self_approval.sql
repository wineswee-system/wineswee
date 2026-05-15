-- ════════════════════════════════════════════════════════════
-- DRY RUN：找「chain step 會解析到申請人本身」的進行中單
--
-- 目的：評估「自簽自」auto-skip 修法的影響面
-- 用法：在 Supabase Studio SQL Editor 直接貼下面查詢跑
-- 不會動 schema、不會改任何資料
--
-- 涵蓋表：
--   expense_requests / resignation_requests / leave_of_absence_requests
--   personnel_transfer_requests / leave_requests / overtime_requests
--   (business_trips / clock_corrections 走 HR fallback，不在 chain，本查詢不含)
--
-- 偵測原理：直接呼叫 _employee_matches_chain_step(applicant, step, applicant)
--   如果回 TRUE → 該關該員工就是合法 approver → 自簽自
--   涵蓋所有 8 種 target_type（applicant_* 系列才會 self-resolve）
-- ════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────
-- ① 總覽：目前還沒推過去的「當下這一關」就會自簽的單
-- ─────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────
-- ② 進階：每張在飛單，列出整條 chain 上「還沒簽 + 會自簽」的關
-- 用來看「auto-skip 後是否還剩至少一關有人簽」
-- self_resolve_steps == remaining_steps  →  整條會全跳光 🚨
-- ─────────────────────────────────────────────────────
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
),
chain_breakdown AS (
  SELECT
    i.tbl, i.id, i.applicant_id, e.name AS applicant_name,
    i.current_step AS cur_step,
    cs.step_order, cs.label, cs.target_type,
    public._employee_matches_chain_step(i.applicant_id, cs.id, i.applicant_id) AS self_resolves
  FROM in_flight i
  JOIN employees e ON e.id = i.applicant_id
  JOIN approval_chain_steps cs ON cs.chain_id = i.approval_chain_id
)
SELECT
  tbl                                                            AS "表",
  id                                                             AS "單號",
  applicant_name                                                 AS "申請人",
  cur_step                                                       AS "當前關",
  COUNT(*) FILTER (WHERE step_order >= cur_step)                 AS "剩餘關數",
  COUNT(*) FILTER (WHERE step_order >= cur_step AND self_resolves) AS "自簽關數",
  CASE
    WHEN COUNT(*) FILTER (WHERE step_order >= cur_step) =
         COUNT(*) FILTER (WHERE step_order >= cur_step AND self_resolves)
    THEN '🚨 全跳光'
    WHEN COUNT(*) FILTER (WHERE step_order >= cur_step AND self_resolves) > 0
    THEN '⚠️ 部分跳'
    ELSE '✅ 正常'
  END                                                            AS "風險",
  STRING_AGG(
    CASE WHEN step_order >= cur_step THEN
      step_order || ':' || label || '(' || target_type || ')'
      || CASE WHEN self_resolves THEN ' ⏭️' ELSE '' END
    END,
    ' → ' ORDER BY step_order
  )                                                              AS "剩餘關 breakdown"
FROM chain_breakdown
GROUP BY tbl, id, applicant_name, cur_step
HAVING COUNT(*) FILTER (WHERE step_order >= cur_step AND self_resolves) > 0
ORDER BY
  -- 全跳光的排最上面（最高風險）
  (COUNT(*) FILTER (WHERE step_order >= cur_step) =
   COUNT(*) FILTER (WHERE step_order >= cur_step AND self_resolves)) DESC,
  tbl, id;


-- ─────────────────────────────────────────────────────
-- ③ 後設統計：哪些 chain step 的 target_type 是 applicant_* 系列（潛在風險面）
-- 數量越多代表越多 chain 可能踩到
-- ─────────────────────────────────────────────────────
SELECT
  target_type                              AS "解析類型",
  COUNT(*)                                 AS "step 數",
  COUNT(DISTINCT chain_id)                 AS "chain 數",
  COUNT(DISTINCT chain_id) FILTER (
    WHERE chain_id IN (
      SELECT approval_chain_id FROM expense_requests WHERE status = '申請中'
      UNION ALL
      SELECT approval_chain_id FROM resignation_requests WHERE status = '申請中'
      UNION ALL
      SELECT approval_chain_id FROM leave_of_absence_requests WHERE status = '申請中'
      UNION ALL
      SELECT approval_chain_id FROM personnel_transfer_requests WHERE status = '申請中'
      UNION ALL
      SELECT approval_chain_id FROM leave_requests WHERE status = '待審核'
      UNION ALL
      SELECT approval_chain_id FROM overtime_requests WHERE status = '待審核'
    )
  )                                        AS "在飛單用到此類型的 chain 數"
FROM approval_chain_steps
WHERE target_type IN (
  'applicant_dept_manager','applicant_store_manager',
  'applicant_section_supervisor','applicant_supervisor'
)
GROUP BY target_type
ORDER BY "step 數" DESC;


-- ─────────────────────────────────────────────────────
-- ④ 哪些員工同時是 applicant_* 系列的目標 → 容易踩雷的人
-- 用 LATERAL + STRING_AGG 處理一人管多個部門/門市的情況
-- ─────────────────────────────────────────────────────
SELECT
  e.id,
  e.name                                     AS "姓名",
  e.position                                 AS "職稱",
  d.name                                     AS "所屬部門",
  managed_depts.names                        AS "管理的部門",
  managed_stores.names                       AS "管理的門市",
  managed_sections.names                     AS "管理的組室"
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
LEFT JOIN LATERAL (
  SELECT STRING_AGG(name, ', ' ORDER BY name) AS names
    FROM departments WHERE manager_id = e.id
) managed_depts ON true
LEFT JOIN LATERAL (
  SELECT STRING_AGG(name, ', ' ORDER BY name) AS names
    FROM stores WHERE manager_id = e.id
) managed_stores ON true
LEFT JOIN LATERAL (
  SELECT STRING_AGG(name, ', ' ORDER BY name) AS names
    FROM department_sections WHERE supervisor_id = e.id
) managed_sections ON true
WHERE e.status = '在職'
  AND (
    managed_depts.names IS NOT NULL
    OR managed_stores.names IS NOT NULL
    OR managed_sections.names IS NOT NULL
  )
ORDER BY e.id;
