-- 修正張丞佑離職特休折現:存的是未來滿1年期間(被折現排除),改成104當下涵蓋離職日的特休 — 2026-07-14
-- 張丞佑(76)離職2026-06-21;只匯了 file2 未來週年(56h/2026-08-04起),漏 file3 當下滿6月特休
-- (24h,期間2026-02-04~2026-08-03,涵蓋離職日) → _compute B2「未生效排除」擋成折現0。
-- 改成當下期間後,離職結清折得到 3 天(24h)。idempotent。
-- 註:另有 4 位離職者(曲相澐/陳富琦/朱紹蕾/李建廷)資料同款,待使用者確認是否一併修。

UPDATE public.leave_balances
   SET total_days = 3, used_days = 0, carry_over_days = 0,
       period_start = '2026-02-04', expires_at = '2026-08-03'
 WHERE employee_id = 76 AND year = 2026 AND leave_type = 'annual';  -- 張丞佑

NOTIFY pgrst, 'reload schema';
