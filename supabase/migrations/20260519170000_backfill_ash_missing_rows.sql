-- ════════════════════════════════════════════════════════════════════════════
-- approval_step_history backfill：INSERT 缺漏的 step row（針對 fixed_emp）
-- ────────────────────────────────────────────────────────────────────────────
-- 問題：chain advance 推進到最後一關時，trigger 可能因「current_step++ 跟
-- status='已核准' 同一個 UPDATE」沒分 fire，最後一關 step row 漏 INSERT。
-- 結果：張啟達（chain step 4 人資備查）這種「最後關 fixed_emp」history
-- 連 row 都沒，前一個 backfill UPDATE 也補不到。
--
-- 修法：對 expense_request 已通過的 step（status / current_step 推斷），
-- 若 chain step 是 fixed_emp 且 history 沒對應 row → INSERT 補回。
-- entered_at / exited_at 用 created_at / approved_at 近似（不精準但夠用）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- expense_requests (主鏈)
INSERT INTO approval_step_history (
  request_type, request_id, organization_id, chain_id,
  step_order, step_label, target_type, entered_at, exited_at,
  action, approver_id, approver_name
)
SELECT
  'expense_request',
  er.id,
  er.organization_id,
  er.approval_chain_id,
  cs.step_order,
  cs.label,
  cs.target_type,
  er.created_at,
  COALESCE(er.approved_at, er.updated_at, NOW()),
  CASE
    WHEN er.status IN ('已駁回','已退回') AND cs.step_order = er.current_step THEN 'rejected'
    ELSE 'approved'
  END,
  cs.target_emp_id,
  e.name
FROM expense_requests er
JOIN approval_chain_steps cs ON cs.chain_id = er.approval_chain_id
JOIN employees e ON e.id = cs.target_emp_id
WHERE cs.target_type = 'fixed_emp'
  AND cs.target_emp_id IS NOT NULL
  AND (
    -- 整單已通過：所有 step 都過
    er.status IN ('已核准','已核銷')
    -- 或單在跑 chain，這 step 已過
    OR (er.status IN ('申請中','待核銷') AND cs.step_order < er.current_step)
    -- 或被駁回，在被駁回的那關
    OR (er.status IN ('已駁回','已退回') AND cs.step_order = er.current_step)
  )
  AND NOT EXISTS (
    SELECT 1 FROM approval_step_history h
    WHERE h.request_type = 'expense_request'
      AND h.request_id = er.id
      AND h.step_order = cs.step_order
  );

-- expense_requests (核銷鏈 settle_chain_id)
INSERT INTO approval_step_history (
  request_type, request_id, organization_id, chain_id,
  step_order, step_label, target_type, entered_at, exited_at,
  action, approver_id, approver_name
)
SELECT
  'expense_settle',
  er.id,
  er.organization_id,
  er.settle_chain_id,
  cs.step_order,
  cs.label,
  cs.target_type,
  er.created_at,
  COALESCE(er.approved_at, er.updated_at, NOW()),
  'approved',
  cs.target_emp_id,
  e.name
FROM expense_requests er
JOIN approval_chain_steps cs ON cs.chain_id = er.settle_chain_id
JOIN employees e ON e.id = cs.target_emp_id
WHERE cs.target_type = 'fixed_emp'
  AND cs.target_emp_id IS NOT NULL
  AND er.settle_chain_id IS NOT NULL
  AND (
    er.status = '已核銷'
    OR (er.status = '待核銷' AND cs.step_order < COALESCE(er.settle_current_step, 0))
    OR (er.status = '核銷已退回' AND cs.step_order = COALESCE(er.settle_current_step, 0))
  )
  AND NOT EXISTS (
    SELECT 1 FROM approval_step_history h
    WHERE h.request_type = 'expense_settle'
      AND h.request_id = er.id
      AND h.step_order = cs.step_order
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
