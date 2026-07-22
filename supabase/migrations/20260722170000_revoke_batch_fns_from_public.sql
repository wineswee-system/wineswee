-- 修正:批次函式 REVOKE 要 FROM PUBLIC(前一支 FROM anon,authenticated 無效) — 2026-07-22
-- ════════════════════════════════════════════════════════════════════════════
-- 20260722160000 用 REVOKE ... FROM anon, authenticated 沒生效,因 DEFINER 函式
-- 預設 EXECUTE 給 PUBLIC → 收 anon/authenticated 不影響 PUBLIC 那層,anon 仍可呼叫
-- (實測 anon 呼叫 issue_birthday_rewards_monthly 仍成功執行)。
-- 正解:REVOKE FROM PUBLIC。
--
-- 只鎖這 2 支「純 cron 批次寫入」函式(查證:除 cron.schedule 外無任何函式內部引用):
--   issue_birthday_rewards_monthly / upgrade_member_levels_all
-- cron 走 postgres owner 不受 REVOKE 影響;另 GRANT service_role 保險。
--
-- ★不動的：
--  - 3 支內部 helper(_create_task_confirmations_for_step/_employee_is_eligible_approver/
--    _notify_delegates_for)被 20+ migration 深度引用(chain/簽核),REVOKE FROM PUBLIC
--    若撞到 INVOKER 呼叫者會弄壞簽核流程,風險>效益(helper 僅回 bool/需合法參數)→保留(accepted risk)。
--  - score_rfm_all/fn_pos_store_monthly_report/manage_position_permission:已有 org guard
--    保護(anon 呼叫→FORBIDDEN),且前端 authenticated 需呼叫,故保留 PUBLIC。
-- ════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.issue_birthday_rewards_monthly(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upgrade_member_levels_all(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.issue_birthday_rewards_monthly(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.upgrade_member_levels_all(bigint) TO service_role;

NOTIFY pgrst, 'reload schema';
