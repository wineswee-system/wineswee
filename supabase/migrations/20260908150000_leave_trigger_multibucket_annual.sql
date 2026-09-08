-- 假勤額度 trigger 升級:特休走「多桶結算優先→annual」(保留一次性舊系統匯入基準,只加/減),退還結算優先反向。
-- 其餘假別單桶。所有核准路徑(網頁/LIFF/簽核鏈/強制通過)皆觸發。補休走 comp ledger 不在此。
-- 已實測:周佳霖(結算有額)扣結算、林襄(結算滿)溢出annual、駁回退回。
CREATE OR REPLACE FUNCTION public._trg_leave_sync_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_delta numeric; v_now boolean; v_was boolean; v_code text;
  v_settle_id int; v_settle_rem numeric; v_annual_id int; v_take numeric; v_off numeric; v_used numeric;
BEGIN
  IF NEW.employee_id IS NULL OR NEW.type = '補休' THEN RETURN NEW; END IF;
  v_now := (NEW.status = '已核准');
  v_was := (TG_OP = 'UPDATE' AND OLD.status = '已核准');
  IF v_now = v_was THEN RETURN NEW; END IF;
  v_delta := CASE WHEN NEW.hours IS NOT NULL AND NEW.hours > 0 THEN NEW.hours/8.0 ELSE COALESCE(NEW.days,0) END;
  IF COALESCE(v_delta,0) = 0 THEN RETURN NEW; END IF;

  IF NEW.type = '特休' THEN
    -- 特休假2025結算(結轉,涵蓋請假日)= 結算優先
    SELECT id, GREATEST(0, total_days - COALESCE(used_days,0)) INTO v_settle_id, v_settle_rem
      FROM leave_balances WHERE employee_id=NEW.employee_id AND leave_type='特休假2025結算'
        AND organization_id=NEW.organization_id AND NEW.start_date BETWEEN period_start AND expires_at
      ORDER BY expires_at LIMIT 1;
    SELECT id INTO v_annual_id FROM leave_balances WHERE employee_id=NEW.employee_id AND leave_type='annual'
        AND organization_id=NEW.organization_id AND NEW.start_date BETWEEN period_start AND expires_at
      ORDER BY period_start DESC LIMIT 1;
    IF v_now THEN  -- 核准:結算優先→annual
      v_take := 0;
      IF v_settle_id IS NOT NULL AND v_settle_rem > 0 THEN
        v_take := LEAST(v_delta, v_settle_rem);
        UPDATE leave_balances SET used_days=COALESCE(used_days,0)+v_take, updated_at=now() WHERE id=v_settle_id;
      END IF;
      IF v_delta - v_take > 0 AND v_annual_id IS NOT NULL THEN
        UPDATE leave_balances SET used_days=COALESCE(used_days,0)+(v_delta-v_take), updated_at=now() WHERE id=v_annual_id;
      END IF;
    ELSE  -- 退還:annual優先退→結算(LIFO,反向)
      v_off := v_delta;
      IF v_settle_id IS NOT NULL THEN
        SELECT COALESCE(used_days,0) INTO v_used FROM leave_balances WHERE id=v_settle_id;
        v_take := LEAST(v_off, v_used);
        UPDATE leave_balances SET used_days=v_used - v_take, updated_at=now() WHERE id=v_settle_id;
        v_off := v_off - v_take;
      END IF;
      IF v_off > 0 AND v_annual_id IS NOT NULL THEN
        UPDATE leave_balances SET used_days=GREATEST(0, COALESCE(used_days,0)-v_off), updated_at=now() WHERE id=v_annual_id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- 其餘假別:單桶(type→code)
  v_code := CASE NEW.type
    WHEN '病假' THEN 'sick' WHEN '事假' THEN 'personal' WHEN '婚假' THEN 'marriage'
    WHEN '喪假' THEN 'bereavement' WHEN '產假' THEN 'maternity' WHEN '陪產假' THEN 'paternity'
    WHEN '生理假' THEN 'menstrual' WHEN '家庭照顧假' THEN 'family' WHEN '公假' THEN 'official'
    WHEN '公傷假' THEN 'injury' ELSE NEW.type END;
  IF v_now THEN
    UPDATE leave_balances SET used_days=COALESCE(used_days,0)+v_delta, updated_at=now()
      WHERE employee_id=NEW.employee_id AND year=EXTRACT(YEAR FROM NEW.start_date)::int AND leave_type=NEW.type;
    IF NOT FOUND THEN
      UPDATE leave_balances SET used_days=COALESCE(used_days,0)+v_delta, updated_at=now()
        WHERE employee_id=NEW.employee_id AND year=EXTRACT(YEAR FROM NEW.start_date)::int AND leave_type=v_code;
    END IF;
  ELSE
    UPDATE leave_balances SET used_days=GREATEST(0,COALESCE(used_days,0)-v_delta), updated_at=now()
      WHERE employee_id=NEW.employee_id AND year=EXTRACT(YEAR FROM NEW.start_date)::int AND leave_type=NEW.type;
    IF NOT FOUND THEN
      UPDATE leave_balances SET used_days=GREATEST(0,COALESCE(used_days,0)-v_delta), updated_at=now()
        WHERE employee_id=NEW.employee_id AND year=EXTRACT(YEAR FROM NEW.start_date)::int AND leave_type=v_code;
    END IF;
  END IF;
  RETURN NEW;
END $function$

