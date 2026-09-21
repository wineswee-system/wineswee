-- 2026-09-02 特休法定下限每日對帳(治本:正職特休不會低於 §38)
--
-- 背景:leave_balances 的特休額度是一次性 script 灌的,灌檔時用「灌檔當天年資」而非
--   「該期起日年資」,又沒有跨年資階自動更新 → 正職可能卡在偏低值(例:詹健如滿1年仍存3)。
--   而折現(_settle_expired_leave_cashout / cashout_annual_leave)是直接讀 leave_balances.total_days,
--   不會重算法定 → 存太低(或存0)就真的少折錢、且靜默發出。
--
-- 治本:每日跑 reconcile_annual_leave_floor —— 把「正職、生效中、低於 §38 法定」的特休
--   total_days 補到法定下限(calc_annual_leave_entitlement(join_date, period_start))。
--   只往上補、不砍(104 匯入高值不動);兼職/時薪不碰(比例計給合法);過期/未生效期間不碰。

CREATE OR REPLACE FUNCTION public.reconcile_annual_leave_floor(p_dry_run boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_rows json;
  v_cnt  int := 0;
BEGIN
  SELECT COALESCE(json_agg(json_build_object(
           'employee_id', x.employee_id, 'name', x.name, 'balance_id', x.id,
           'period_start', x.period_start, 'old', x.stored, 'new', x.floor
         ) ORDER BY x.name), '[]'::json), count(*)
    INTO v_rows, v_cnt
  FROM (
    SELECT lb.id, lb.employee_id, e.name, lb.period_start,
           lb.total_days::numeric AS stored,
           public.calc_annual_leave_entitlement(e.join_date, lb.period_start) AS floor
      FROM public.leave_balances lb
      JOIN public.employees e ON e.id = lb.employee_id
     WHERE lb.leave_type = 'annual' AND e.status = '在職'
       AND e.employment_type <> '兼職' AND COALESCE(e.salary_type,'') <> 'hourly'
       AND e.join_date IS NOT NULL
       AND lb.period_start <= current_date AND lb.expires_at >= current_date
       AND lb.total_days::numeric < public.calc_annual_leave_entitlement(e.join_date, lb.period_start)
  ) x;

  IF NOT p_dry_run AND v_cnt > 0 THEN
    UPDATE public.leave_balances lb
       SET total_days = public.calc_annual_leave_entitlement(e.join_date, lb.period_start),
           updated_at = now()
      FROM public.employees e
     WHERE e.id = lb.employee_id AND lb.leave_type = 'annual' AND e.status = '在職'
       AND e.employment_type <> '兼職' AND COALESCE(e.salary_type,'') <> 'hourly'
       AND e.join_date IS NOT NULL
       AND lb.period_start <= current_date AND lb.expires_at >= current_date
       AND lb.total_days::numeric < public.calc_annual_leave_entitlement(e.join_date, lb.period_start);
  END IF;

  RETURN json_build_object('dry_run', p_dry_run, 'corrected', v_cnt, 'items', v_rows);
END $fn$;

-- 每日對帳(08:09 台北 = 00:09 UTC);idempotent 重掛
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reconcile-annual-leave-floor';
SELECT cron.schedule('reconcile-annual-leave-floor', '9 0 * * *',
                     'SELECT public.reconcile_annual_leave_floor(false)');

-- 當下回填(修好詹健如滿1年3→7、施怡廷滿6月0→3 等)
SELECT public.reconcile_annual_leave_floor(false);
