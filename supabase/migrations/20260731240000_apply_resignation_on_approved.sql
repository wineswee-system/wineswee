-- 離職申請簽核完成 → 自動套用到員工(帶入 resign_date/reason) — 2026-07-31
-- ════════════════════════════════════════════════════════════════════════════
-- 現況斷點:resignation_requests 走完簽核鏈只把 status 設「已核准」(hr_chain_approve),
-- 不會寫員工的 resign_date/resign_reason/status,也沒 trigger → HR 還得手動再按離職。
-- 修:新增 AFTER UPDATE OF status 的 trigger,status 轉「已核准」時自動呼叫
--   apply_employee_resignation(員工, planned_resign_date, reason, 'voluntary')。
-- apply 內含日期閘門:離職日 >= 今天 → 維持在職到最後一天、隔天 cron 轉;過去 → 立即生效。
-- 只做離職(resignation),不動留停/異動/增補。附加式(不改 hr_chain_approve)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trg_apply_resignation_on_approved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- 離職申請簽核完成(→已核准,且非重複)→ 自動套用到員工
  IF NEW.status = '已核准'
     AND COALESCE(OLD.status, '') IS DISTINCT FROM '已核准'
     AND NEW.employee_id IS NOT NULL
     AND NEW.planned_resign_date IS NOT NULL THEN
    PERFORM public.apply_employee_resignation(
      NEW.employee_id,
      NEW.planned_resign_date,
      COALESCE(NULLIF(NEW.reason, ''), '個人因素'),
      'voluntary'
    );
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_apply_resignation_on_approved ON public.resignation_requests;
CREATE TRIGGER trg_apply_resignation_on_approved
  AFTER UPDATE OF status ON public.resignation_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_apply_resignation_on_approved();

NOTIFY pgrst, 'reload schema';
