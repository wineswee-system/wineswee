-- 例假加班 → 自動給 8h 補休(補假):原本只認「班表有『例假』列」,
--   但行政人員沒排班(週日=例假)→ 被漏掉。改用加班單 ot_category='weekly_off'(或班表例假)判定。
-- (1) 修 trigger  (2) 補建歷史漏掉的 8h 補休

CREATE OR REPLACE FUNCTION public.trg_holiday_makeup_comp_time()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_date date;
  v_base numeric;
  v_rate numeric;
  v_org  int;
BEGIN
  IF NEW.status <> '已核准' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = '已核准' THEN RETURN NEW; END IF;
  v_date := COALESCE(NEW.request_date, NEW.date);
  IF v_date IS NULL THEN RETURN NEW; END IF;

  -- 「例假加班」才給補假:加班單本身標 weekly_off(含行政週日隱性例假),或班表明寫「例假」
  IF NOT (
    COALESCE(NEW.ot_category,'') = 'weekly_off'
    OR EXISTS (
      SELECT 1 FROM public.schedules s
       WHERE s.employee_id = NEW.employee_id AND s.date = v_date
         AND COALESCE(s.shift,'') LIKE '%例假%'
    )
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(ss.base_salary,0), e.organization_id
    INTO v_base, v_org
    FROM employees e LEFT JOIN salary_structures ss ON ss.employee_id = e.id
   WHERE e.id = NEW.employee_id;
  IF v_base IS NULL OR v_base <= 0 THEN RETURN NEW; END IF;
  v_rate := ROUND(v_base / 30.0 / 8.0, 2);

  INSERT INTO public.comp_time_ledger (
    employee_id, overtime_request_id, organization_id,
    hours, ot_date, expires_at, frozen_hourly_rate, frozen_ot_amount, status, source
  ) VALUES (
    NEW.employee_id, NULL, COALESCE(v_org, NEW.organization_id),
    8, v_date, v_date + INTERVAL '1 year' - INTERVAL '1 day',
    v_rate, ceil(8 * v_rate), 'active', 'holiday_makeup'
  )
  ON CONFLICT (employee_id, ot_date) WHERE source = 'holiday_makeup' DO NOTHING;

  RETURN NEW;
END $function$;

-- 補建歷史:已核准的例假加班(weekly_off)但沒有 8h 補休者,每(人,日)補一筆 8h
INSERT INTO public.comp_time_ledger (
  employee_id, overtime_request_id, organization_id,
  hours, ot_date, expires_at, frozen_hourly_rate, frozen_ot_amount, status, source
)
SELECT DISTINCT ON (o.employee_id, COALESCE(o.request_date, o.date))
  o.employee_id, NULL, e.organization_id,
  8, COALESCE(o.request_date, o.date),
  COALESCE(o.request_date, o.date) + INTERVAL '1 year' - INTERVAL '1 day',
  ROUND(COALESCE(ss.base_salary,0)/30.0/8.0, 2),
  ceil(8 * ROUND(COALESCE(ss.base_salary,0)/30.0/8.0, 2)),
  'active', 'holiday_makeup'
FROM public.overtime_requests o
JOIN public.employees e ON e.id = o.employee_id
LEFT JOIN public.salary_structures ss ON ss.employee_id = o.employee_id
WHERE o.status = '已核准' AND o.deleted_at IS NULL
  AND o.ot_category = 'weekly_off'
  AND COALESCE(ss.base_salary,0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.comp_time_ledger c
     WHERE c.employee_id = o.employee_id
       AND c.ot_date = COALESCE(o.request_date, o.date)
       AND c.source = 'holiday_makeup'
  )
ORDER BY o.employee_id, COALESCE(o.request_date, o.date)
ON CONFLICT (employee_id, ot_date) WHERE source = 'holiday_makeup' DO NOTHING;
