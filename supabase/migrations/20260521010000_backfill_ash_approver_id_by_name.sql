-- ════════════════════════════════════════════════════════════════════════════
-- 補 approval_step_history.approver_id（用 approver_name join employees.name）
-- ────────────────────────────────────────────────────────────────────────────
-- 根因：expense_requests 沒有 approver 欄位，ash trigger 的 v_approver 永遠是
-- NULL → approver_id 從未被填進去。approver_name 是由其他 RPC 直接寫的。
-- 這個 backfill 用 approver_name = employees.name 把所有缺 ID 的歷史 row 補齊。
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.approval_step_history ash
SET approver_id = e.id
FROM public.employees e
WHERE ash.approver_id IS NULL
  AND ash.approver_name IS NOT NULL
  AND ash.approver_name <> ''
  AND e.name = ash.approver_name
  AND ash.action IN ('approved', 'rejected');
