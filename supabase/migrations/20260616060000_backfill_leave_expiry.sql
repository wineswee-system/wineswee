-- ════════════════════════════════════════════════════════════════════════════
-- 回填特休到期日 leave_balances.expires_at（讓戰情室「到期提醒」亮）
-- 2026-06-16
--
-- 規則：到職週年制（本系統採用，見 lib/automation/hr.js、lib/leavePolicy.js §38-4
--   「到職週年未休完，次月薪資結清折算」）。當期特休應於「下一個到職週年」前用完，
--   故 expires_at = 下一個到職週年（>= 今天）。
--
-- 安全：
--   - expires_at 僅 UI（假別餘額頁）/ 儀表板讀取；cashout_annual_leave 用 year 欄、
--     薪資加班補休用 comp_time_ledger.expires_at → 本回填「不影響任何結算/薪資」。
--   - 只填 leave_type='annual' 且 expires_at 為 NULL（idempotent，可重跑）。
--   - expires_at 是手動可調欄位，回填後 admin 仍可在假別餘額頁個別覆寫。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.leave_balances lb
SET expires_at = nx.next_ann
FROM (
  SELECT e.id,
    CASE
      WHEN (e.join_date + make_interval(years => date_part('year', age(current_date, e.join_date))::int))::date >= current_date
        THEN (e.join_date + make_interval(years => date_part('year', age(current_date, e.join_date))::int))::date
      ELSE (e.join_date + make_interval(years => date_part('year', age(current_date, e.join_date))::int + 1))::date
    END AS next_ann
  FROM public.employees e
  WHERE e.join_date IS NOT NULL
) nx
WHERE lb.employee_id = nx.id
  AND lb.leave_type = 'annual'
  AND lb.expires_at IS NULL;

COMMIT;
