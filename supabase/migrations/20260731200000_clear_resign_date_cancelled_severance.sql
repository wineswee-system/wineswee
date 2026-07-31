-- 資遣已取消但員工 resign_date 沒清 → 清掉,恢復純在職 — 2026-07-31
-- ════════════════════════════════════════════════════════════════════════════
-- 資遣(severance_records)取消時,舊的 handleCancel 只改 severance 狀態,沒清員工的
-- 離職預告(resign_date/reason/type)→ 員工端仍顯示「離職 7/31」、每日 cron 到期還會
-- 把他離職(慘案:孫嘉澤 emp131,資遣已 cancelled 但 resign_date=2026-07-31 還在)。
-- 清掉「有 cancelled 資遣、且沒有其他生效中資遣、resign_date 還在」的在職員工。
-- (前端 handleCancel 已同步修:之後取消資遣會一併清員工;此處補既有資料。)
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.employees e
   SET status = '在職', resign_date = NULL, resign_reason = NULL, resign_type = NULL
 WHERE e.status = '在職'
   AND e.resign_date IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.severance_records sv
                WHERE sv.employee_id = e.id AND sv.status = 'cancelled')
   AND NOT EXISTS (SELECT 1 FROM public.severance_records sv
                    WHERE sv.employee_id = e.id AND sv.status IN ('pending', 'approved', 'paid'));

NOTIFY pgrst, 'reload schema';
