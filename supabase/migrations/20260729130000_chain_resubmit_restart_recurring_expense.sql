-- 簽核:編輯重送→從關0重簽 — 補上「經常性費用報銷」(expenses) — 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- 承 20260729120000(expense_requests / form_submissions)。經常性費用報銷走 expenses 表,
-- 差異:待簽狀態是 '待審核'(非 '申請中')。expenses 的關卡通知靠既有 trigger
--   _notify_expense_report_updated(status→待審核 時依 current_step 推),故本支只需把
--   current_step 歸 0,既有重送通知即會自動指向關 0(不另加 AFTER 通知,避免重複)。
--
-- 作法:把 20260729120000 的 BEFORE 函式條件放寬(接受 '申請中' 或 '待審核'),
--       再把同一支 BEFORE trigger 掛到 expenses。expense_requests/form_submissions
--       行為不變(它們重送一律 '申請中',放寬條件對它們等效)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trg_chain_reset_step_resubmit_ext()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- 被駁(已駁回/已退回)→ 回到待簽(申請中=費用申請/自建表單;待審核=經常性費用報銷)
  IF COALESCE(OLD.status,'') IN ('已駁回','已退回')
     AND NEW.status IN ('申請中','待審核') THEN
    NEW.current_step := 0;
  END IF;
  RETURN NEW;
END $function$;

-- 掛 BEFORE trigger 到 expenses(idempotent)。AFTER 重推不掛 —— 靠既有 report 通知。
DROP TRIGGER IF EXISTS trg_chain_reset_step_resubmit_ext ON public.expenses;
CREATE TRIGGER trg_chain_reset_step_resubmit_ext
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._trg_chain_reset_step_resubmit_ext();

NOTIFY pgrst, 'reload schema';
