-- ════════════════════════════════════════════════════════════
-- DRY RUN ③ applicant_* 系列 target_type 統計
--
-- 用法：Supabase Studio SQL Editor 貼進去跑
-- 不會動任何資料
--
-- 期待結果：
--   step 數    — applicant_* 系列在所有 chain 中出現幾次
--   chain 數   — 用到此類型的 chain 有幾條
--   在飛單用到 — 有未結單在用此類型的 chain 有幾條
--
-- 數字越大，潛在影響面越廣
-- ════════════════════════════════════════════════════════════

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
