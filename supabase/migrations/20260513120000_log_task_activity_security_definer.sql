-- ════════════════════════════════════════════════════════════
-- 修：log_task_activity 改 SECURITY DEFINER 避免被 RLS 擋
-- 2026-05-13
--
-- 慘案：admin 在「專案流程」按刪除流程 → 失敗:
--   ERROR: new row violates row-level security policy for table "task_activity"
--
-- 根因：
--   - log_task_activity() trigger function 沒設 SECURITY DEFINER
--   - AFTER INSERT/UPDATE tasks 觸發 → 試圖 INSERT task_activity (audit log)
--   - 用 caller (admin) 權限寫 → task_activity 的 RLS check_expr：
--       (organization_id = current_employee_org())
--       OR (current_employee_role() IN ('admin','super_admin'))
--   - admin 的 current_employee_role() 可能回非 'admin' 字串（jwt claim 沒設？）
--     → RLS 兩個條件都 fail → INSERT abort → 整個 UPDATE rollback
--   - super_admin 通過所以「super_admin 可以刪、admin 不能」
--
-- 修法（標準 audit log pattern）：
--   ALTER FUNCTION ... SECURITY DEFINER；trigger 用 owner (postgres) 權限
--   寫 audit log，繞過 RLS。Audit log 本來就該由系統寫，不該允許 user 直寫。
--
-- 不需要修的 trigger function（只動 NEW，不會被 RLS 擋）：
--   - trg_inherit_organization_id_from_employee
--   - trg_overtime_auto_category
--   - trg_overtime_sync_legacy_columns
-- ════════════════════════════════════════════════════════════

BEGIN;

ALTER FUNCTION public.log_task_activity() SECURITY DEFINER;

COMMIT;

-- 驗證
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'log_task_activity';
-- 應該回 prosecdef = true
