-- 修例假選現金被重複送 8h 補假(16h) → 砍 trg_create_comp_time_ledger 情況二
-- 2026-07-09  例假加班有兩支 trigger 各送 8h 法定補假:
--   trg_create_comp_time_ledger 情況二(weekly_off+pay→8h) + trg_holiday_makeup_comp_time(班表例假→8h)。
--   選現金 → 兩支都跑 = 16h 補假(應 8h)。實證:施怡廷 6/16 0.5h例假現金 → ledger 兩筆8h。
--   修:砍情況二,補假統一由 holiday_makeup 發一次。選補休不受影響(情況一 OT時數 + holiday_makeup 8h = 16h,正確)。
--   idempotent:CREATE OR REPLACE。不動 trigger 掛載、不動現有資料(已用 104 重建)。

CREATE OR REPLACE FUNCTION public.trg_create_comp_time_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hours        NUMERIC;
  v_date         DATE;
  v_base         NUMERIC;
  v_hourly_rate  NUMERIC;
  v_amount       NUMERIC;
  v_org_id       INT;
  v_category     TEXT;
  v_salary_type  TEXT;
  v_emp_category TEXT;
BEGIN
  -- 只在 status 轉為「已核准」時觸發
  IF NEW.status <> '已核准' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = '已核准' THEN
    RETURN NEW;  -- 已經是核准了，不重發
  END IF;

  v_hours := COALESCE(NEW.ot_hours, NEW.hours);
  v_date  := COALESCE(NEW.request_date, NEW.date);

  IF v_hours IS NULL OR v_hours <= 0 OR v_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(ss.base_salary, 0),
    e.organization_id,
    COALESCE(ss.salary_type, 'monthly'),
    COALESCE(ss.employment_category, '')
  INTO v_base, v_org_id, v_salary_type, v_emp_category
  FROM public.employees e
  LEFT JOIN public.salary_structures ss ON ss.employee_id = e.id
  WHERE e.id = NEW.employee_id;

  IF v_base IS NULL OR v_base <= 0 THEN
    RAISE NOTICE 'comp_time ledger skipped: employee % has no base_salary', NEW.employee_id;
    RETURN NEW;
  END IF;

  v_hourly_rate := ROUND(v_base / 30.0 / 8.0, 2);

  v_category := COALESCE(
    NEW.ot_category,
    public.classify_overtime_category_v2(v_date, NEW.employee_id)
  );

  -- ─── 情況一（原有邏輯）：員工選補休 ────────────────────────────────────
  IF COALESCE(NEW.ot_type, 'pay') = 'comp_time' THEN
    v_amount := public._compute_ot_pay(v_hours, v_hourly_rate, v_category);

    INSERT INTO public.comp_time_ledger (
      employee_id, overtime_request_id, organization_id,
      hours, ot_date, expires_at,
      frozen_hourly_rate, frozen_ot_amount,
      status
    ) VALUES (
      NEW.employee_id, NEW.id, COALESCE(v_org_id, NEW.organization_id),
      v_hours, v_date, v_date + INTERVAL '1 year' - INTERVAL '1 day',
      v_hourly_rate, v_amount,
      'active'
    )
    ON CONFLICT (overtime_request_id) DO NOTHING;

    RETURN NEW;
  END IF;

  -- 情況二（例假現金→8h 補假）已移除：改由 trg_holiday_makeup_comp_time 單一負責,
  -- 避免例假選現金時被兩支 trigger 各送 8h → 重複 16h。選補休仍走情況一(OT時數)+holiday_makeup(8h補假)=16h。

  RETURN NEW;
END $function$;

NOTIFY pgrst, 'reload schema';
