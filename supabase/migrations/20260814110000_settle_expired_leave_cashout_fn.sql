-- 2026-08-14 到期特休/2025結算/舊補休結算 每月自動折現 —— per-employee settle 函式(含扣待審核防線+離職/編制外守門)
CREATE OR REPLACE FUNCTION public._settle_expired_leave_cashout(p_emp_id integer, p_run_id integer, p_month_end date, p_dry_run boolean DEFAULT true)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric := 0;
  v_amt numeric;
  v_daily numeric;
  v_hourly numeric;
  v_status text;
  v_inpay boolean;
  v_pending_days numeric;
  v_cashable numeric;
  rec RECORD;
BEGIN
  SELECT e.status, COALESCE(e.in_payroll,true),
    CASE WHEN COALESCE(e.salary_type,'')='hourly' THEN COALESCE(e.base_salary,0)/30.0
         ELSE public._employee_avg_monthly_wage(e.id)/30.0 END,
    public._employee_avg_monthly_wage(e.id)/240.0
  INTO v_status, v_inpay, v_daily, v_hourly
  FROM employees e WHERE e.id = p_emp_id;

  -- 離職(其特休折現由離職當月引擎 v_unused_payout 處理)、編制外(in_payroll=false)→ 不折
  IF v_status IS DISTINCT FROM '在職' OR NOT v_inpay THEN RETURN 0; END IF;

  FOR rec IN
    SELECT id, leave_type, total_days, COALESCE(carry_over_days,0) AS carry, period_start, expires_at,
      (total_days + COALESCE(carry_over_days,0) - used_days) AS unused
    FROM leave_balances
    WHERE employee_id = p_emp_id AND expires_at < p_month_end
      AND (total_days + COALESCE(carry_over_days,0) - used_days) > 0
      AND leave_type IN ('annual','特休假2025結算','舊人資系統補休結算')
  LOOP
    -- 扣掉「待審核/審核中/申請中」的請假(同假別、落在該餘額期間內)→ 已經請掉的不折
    SELECT COALESCE(SUM(COALESCE(lr.hours, lr.days*8)),0)/8.0
      INTO v_pending_days
      FROM leave_requests lr
     WHERE lr.employee_id = p_emp_id
       AND lr.status IN ('待審核','審核中','申請中')
       AND lr.deleted_at IS NULL
       AND ( lr.type = rec.leave_type
             OR (rec.leave_type='annual' AND lr.type IN ('特休','annual','特別休假')) )
       AND (rec.period_start IS NULL OR lr.start_date >= rec.period_start)
       AND (rec.expires_at   IS NULL OR lr.start_date <= rec.expires_at);

    v_cashable := GREATEST(0, rec.unused - COALESCE(v_pending_days,0));
    CONTINUE WHEN v_cashable <= 0;

    IF rec.leave_type = '舊人資系統補休結算' THEN
      v_amt := ceil(v_cashable * 8 * v_hourly * 1.34);   -- 補休:平均時薪 × 時數 × 1.34
    ELSE
      v_amt := ceil(v_cashable * v_daily);               -- 特休:平均工資/30 × 天
    END IF;
    v_total := v_total + COALESCE(v_amt,0);

    IF NOT p_dry_run THEN
      -- 標記已折清:used_days 補到「總 − 剛折的可折量」(保留待審核那部分,等它核准再扣)
      UPDATE leave_balances SET used_days = (total_days + rec.carry) - COALESCE(v_pending_days,0) WHERE id = rec.id;
    END IF;
  END LOOP;

  RETURN v_total;
END $function$;
