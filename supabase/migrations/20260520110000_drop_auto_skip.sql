-- ════════════════════════════════════════════════════════════════════════════
-- 刪除所有 auto-skip 機制
-- 2026-05-20
--
-- 原因：auto-skip（自簽跳過 + 重複審核人跳過）邏輯不符合需求，
--       改由 chain 設定本身控制，LIFF 顯示審核人身分取代跳過行為。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── expense_requests：自簽跳過 ────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_z_auto_skip_self_approval_insert ON expense_requests;
DROP TRIGGER IF EXISTS trg_z_auto_skip_self_approval_update ON expense_requests;

-- ─── expense_requests：重複審核人跳過 ─────────────────────────────────────
DROP TRIGGER IF EXISTS trg_zz_auto_skip_dup_approver_insert ON expense_requests;
DROP TRIGGER IF EXISTS trg_zz_auto_skip_dup_approver_update ON expense_requests;

-- ─── HR B 類：重複審核人跳過 ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_insert ON resignation_requests;
DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_update ON resignation_requests;

DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_insert ON leave_of_absence_requests;
DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_update ON leave_of_absence_requests;

DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_insert ON personnel_transfer_requests;
DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_update ON personnel_transfer_requests;

DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_insert ON headcount_requests;
DROP TRIGGER IF EXISTS trg_z_auto_skip_dup_approver_update ON headcount_requests;

-- ─── 函式清除 ──────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.auto_skip_self_approval_expense_request();
DROP FUNCTION IF EXISTS public.auto_skip_dup_approver_expense_request();
DROP FUNCTION IF EXISTS public.auto_skip_dup_approver_hr();
DROP FUNCTION IF EXISTS public._step_approver_has_later_dup(INT, INT, INT);
DROP FUNCTION IF EXISTS public._resolve_step_single_approver(INT, INT, INT);

COMMIT;

NOTIFY pgrst, 'reload schema';
