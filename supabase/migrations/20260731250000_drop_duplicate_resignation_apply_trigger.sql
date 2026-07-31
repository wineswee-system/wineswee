-- 移除重複的離職自動套用 trigger — 2026-07-31
-- ════════════════════════════════════════════════════════════════════════════
-- 20260731240000 誤加了 trg_apply_resignation_on_approved,但系統早已有
-- trg_resign_cascade → trg_resignation_apply_on_approve() 在做同一件事(status→已核准
-- 就呼叫 apply_employee_resignation,且含 reason_detail、走日期閘門)。
-- 兩支會雙重呼叫 apply → 移除我加的那支(既有的保留即可)。
-- (先前誤判「無 trigger」是查詢腳本回傳處理錯,實際一直都有。)
-- ════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_apply_resignation_on_approved ON public.resignation_requests;
DROP FUNCTION IF EXISTS public._trg_apply_resignation_on_approved();

NOTIFY pgrst, 'reload schema';
