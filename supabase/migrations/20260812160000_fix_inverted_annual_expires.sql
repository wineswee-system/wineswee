-- 2026-08-12 修正 annual 現在期「到期日<起日」的壞區間(害整列被前端當已過期而不顯示)。
-- 案例:潘胤傑 annual 2026 期間 2026-06-01 ~ 2026-05-31(到期少一年)→ 前端 expires<今天 → 跳過
--       → 他 §38 7天(56h)特休整列消失。修=到期日補成 起日+1年-1天(標準週年期一年)。
-- 範圍:全庫 annual 只有這 1 筆反轉(已掃 86 列),但寫成通則以防再發生。
UPDATE public.leave_balances
   SET expires_at = (period_start + INTERVAL '1 year' - INTERVAL '1 day')::date
 WHERE leave_type = 'annual'
   AND period_start IS NOT NULL
   AND expires_at IS NOT NULL
   AND expires_at < period_start;
