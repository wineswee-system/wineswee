-- ════════════════════════════════════════════════════════════
-- DRY RUN ⑤ Chain 中是否有「連續兩關同一人」
--
-- 用法：Supabase Studio SQL Editor 貼進去跑
-- 不會動任何資料
--
-- 目的：評估「連簽自動跳過」修法的必要性
--
-- 期待結果：
--   0 筆          → 沒 chain 這樣設計，連簽問題不存在，**不用做修法**
--   1-3 筆        → 少量，請 admin 直接改 chain 設定（換人 / 合併兩關）
--   4+ 筆         → 普遍，考慮做程式自動跳過
--
-- 偵測類型（同一筆 chain 內，step N 跟 step N+1）：
--   🚨 固定同一人        — 兩關都 fixed_emp 且 target_emp_id 相同
--   🚨 同部門主管        — 兩關都 specific_dept_manager 且同部門
--   🚨 同店店長          — 兩關都 specific_store_manager 且同門市
--   🚨 同組主管          — 兩關都 specific_section_supervisor 且同組
--   ⚠️  同 applicant_* 類 — 兩關都同類型 applicant_*，依申請人可能同人
--
-- 未偵測（跨類型同人）：
--   例：step N fixed_emp = 陳虹（id 52）+ step N+1 specific_dept_manager（陳虹管的部門）
--   這要解 emp set 交集才判得出，dry-run 暫不處理。
-- ════════════════════════════════════════════════════════════

WITH pairs AS (
  SELECT
    cs1.chain_id, ac.name AS chain_name,
    cs1.step_order AS step_a, cs2.step_order AS step_b,
    cs1.label      AS label_a, cs2.label      AS label_b,
    cs1.target_type AS type_a, cs2.target_type AS type_b,
    cs1.target_emp_id      AS emp_a,   cs2.target_emp_id      AS emp_b,
    cs1.target_dept_id     AS dept_a,  cs2.target_dept_id     AS dept_b,
    cs1.target_store_id    AS store_a, cs2.target_store_id    AS store_b,
    cs1.target_section_id  AS sec_a,   cs2.target_section_id  AS sec_b
  FROM approval_chain_steps cs1
  JOIN approval_chain_steps cs2
    ON cs2.chain_id = cs1.chain_id
   AND cs2.step_order = cs1.step_order + 1
  JOIN approval_chains ac ON ac.id = cs1.chain_id
)
SELECT
  chain_name                                                AS "Chain",
  chain_id                                                  AS "ID",
  step_a || ': ' || label_a                                 AS "前一關",
  type_a                                                    AS "前類型",
  step_b || ': ' || label_b                                 AS "後一關",
  type_b                                                    AS "後類型",
  CASE
    WHEN type_a = 'fixed_emp' AND type_b = 'fixed_emp' AND emp_a = emp_b
      THEN '🚨 固定同一人 (emp_id ' || emp_a || ')'
    WHEN type_a = 'specific_dept_manager' AND type_b = 'specific_dept_manager' AND dept_a = dept_b
      THEN '🚨 同部門主管 (dept_id ' || dept_a || ')'
    WHEN type_a = 'specific_store_manager' AND type_b = 'specific_store_manager' AND store_a = store_b
      THEN '🚨 同店店長 (store_id ' || store_a || ')'
    WHEN type_a = 'specific_section_supervisor' AND type_b = 'specific_section_supervisor' AND sec_a = sec_b
      THEN '🚨 同組主管 (sec_id ' || sec_a || ')'
    WHEN type_a LIKE 'applicant_%' AND type_b LIKE 'applicant_%' AND type_a = type_b
      THEN '⚠️ 同 ' || type_a || '（依申請人可能同人）'
    ELSE NULL
  END                                                       AS "同人風險"
FROM pairs
WHERE
  (type_a = 'fixed_emp' AND type_b = 'fixed_emp' AND emp_a = emp_b)
  OR (type_a = 'specific_dept_manager' AND type_b = 'specific_dept_manager' AND dept_a = dept_b)
  OR (type_a = 'specific_store_manager' AND type_b = 'specific_store_manager' AND store_a = store_b)
  OR (type_a = 'specific_section_supervisor' AND type_b = 'specific_section_supervisor' AND sec_a = sec_b)
  OR (type_a LIKE 'applicant_%' AND type_b LIKE 'applicant_%' AND type_a = type_b)
ORDER BY chain_id, step_a;
