-- ════════════════════════════════════════════════════════════
-- DRY RUN ② 整條 chain 的「自簽」分布
--
-- 用法：Supabase Studio SQL Editor 貼進去跑
-- 不會動任何資料
--
-- 期待結果：
--   🚨 全跳光 → 該單 auto-skip 後沒人簽 = 高風險
--   ⚠️ 部分跳 → 跳幾關但還有人簽 = 中等
--   ✅ 正常   → 不會出現在此列表（HAVING 已過濾）
--
-- 看「🚨 全跳光」有幾筆，決定後續走法
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
