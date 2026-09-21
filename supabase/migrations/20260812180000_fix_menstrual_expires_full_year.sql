-- 2026-08-12 修生理假(menstrual)到期日:匯入時全被設成 2026-01-31(只到一月)→ 過了1/31,
--   前端「expires<今天就跳過」把整個生理假濾掉(web 假勤明細 2026分頁、LIFF 額度頁都中)。
--   生理假是每月1天、整年適用 → 期間應涵蓋整個曆年。修:period_start=年初、expires=年底。
-- 範圍:113 筆(全部 expires=2026-01-31),各自補成該 year 的 1/1 ~ 12/31。
UPDATE public.leave_balances
   SET period_start = make_date(year, 1, 1),
       expires_at   = make_date(year, 12, 31)
 WHERE leave_type = 'menstrual'
   AND (period_start IS DISTINCT FROM make_date(year, 1, 1)
        OR expires_at IS DISTINCT FROM make_date(year, 12, 31));
