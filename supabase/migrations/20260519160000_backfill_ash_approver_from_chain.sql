-- ════════════════════════════════════════════════════════════════════════════
-- approval_step_history backfill：從 chain step (fixed_emp) 反推 approver
-- ────────────────────────────────────────────────────────────────────────────
-- 問題：chain 中間關卡簽核時，xxx_step_advance RPC 只 UPDATE current_step
--      沒 set NEW.approver / NEW.approved_by → ash trigger 抓不到當下簽核人
--      → 大量 history row 的 approver_name / approver_id 是 NULL
--
-- 結果：使用者「已簽核」tab 看不到自己中間關簽過的單（如 Zoey/Dave/Danny
-- 實際各簽 5+ 張，但 history 只查得到 Dave 2 筆 [因為他是最後關]）
--
-- 修法：對 action IN approved/rejected 但 approver_id IS NULL 的 history row，
-- join approval_chain_steps 反推「該關 chain step 的 target_emp_id」
-- （只對 fixed_emp target_type，因為它唯一），填回 approver_id + approver_name
--
-- 動態 target (applicant_dept_manager 等) 不在這次 backfill 範圍
-- — 它解出來可能多人或受申請人影響，不能單純 INSERT
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE approval_step_history ash
   SET approver_id   = cs.target_emp_id,
       approver_name = COALESCE(NULLIF(ash.approver_name, ''), e.name)
  FROM approval_chain_steps cs
  LEFT JOIN employees e ON e.id = cs.target_emp_id
 WHERE cs.chain_id = ash.chain_id
   AND cs.step_order = ash.step_order
   AND cs.target_type = 'fixed_emp'
   AND cs.target_emp_id IS NOT NULL
   AND ash.action IN ('approved', 'rejected')
   AND ash.approver_id IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
