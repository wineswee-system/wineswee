-- 例假出勤 → 自動給 8h 補休（額外贈送，非二選一）
-- 2026-07-08  規則(老闆確認)：例假上班 = ×1 薪(已做) + 額外一天(8h)補休。
--   過期兌現(a)；期限 1 年(對齊現有補休)。只例假，不含國定/休息日。
-- 最小侵入：沿用 comp_time_ledger，只加 source 欄；例假補休用 overtime_request_id=NULL
--   避開既有 UNIQUE(overtime_request_id)；每員工每日唯一(partial index)防重複。
--   不動既有「加班換補休」trigger。idempotent。

BEGIN;

-- 1. 來源標記（既有列預設 ot_choice）
ALTER TABLE public.comp_time_ledger
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ot_choice';

-- 2. 例假補休不綁單 → 放寬 NOT NULL（既有「加班換補休」照樣帶 request_id，不受影響）
ALTER TABLE public.comp_time_ledger
  ALTER COLUMN overtime_request_id DROP NOT NULL;

-- 3. 每員工每個例假日只給一次補休
CREATE UNIQUE INDEX IF NOT EXISTS uq_comp_makeup_per_day
  ON public.comp_time_ledger (employee_id, ot_date)
  WHERE source = 'holiday_makeup';

-- 4. Trigger：例假日有已核准加班 → 建 8h 補休 ledger
CREATE OR REPLACE FUNCTION public.trg_holiday_makeup_comp_time()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  -- 只在「例假日」出勤才給（班表標例假）
  IF NOT EXISTS (
    SELECT 1 FROM public.schedules s
     WHERE s.employee_id = NEW.employee_id AND s.date = v_date
       AND COALESCE(s.shift,'') LIKE '%例假%'
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
END $$;

DROP TRIGGER IF EXISTS trg_overtime_holiday_makeup ON public.overtime_requests;
CREATE TRIGGER trg_overtime_holiday_makeup
  AFTER INSERT OR UPDATE OF status ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_holiday_makeup_comp_time();

-- 5. 回填既有「已核准 + 例假日」出勤（每員工每日一筆 8h）
INSERT INTO public.comp_time_ledger (
  employee_id, overtime_request_id, organization_id,
  hours, ot_date, expires_at, frozen_hourly_rate, frozen_ot_amount, status, source
)
SELECT DISTINCT ON (o.employee_id, o.request_date)
  o.employee_id, NULL, COALESCE(e.organization_id, o.organization_id),
  8, o.request_date, o.request_date + INTERVAL '1 year' - INTERVAL '1 day',
  ROUND(COALESCE(ss.base_salary,0)/30.0/8.0, 2),
  ceil(8 * ROUND(COALESCE(ss.base_salary,0)/30.0/8.0, 2)),
  'active', 'holiday_makeup'
FROM public.overtime_requests o
JOIN public.employees e ON e.id = o.employee_id
LEFT JOIN public.salary_structures ss ON ss.employee_id = o.employee_id
WHERE o.status = '已核准'
  AND COALESCE(ss.base_salary,0) > 0
  AND EXISTS (
    SELECT 1 FROM public.schedules s
     WHERE s.employee_id = o.employee_id AND s.date = o.request_date
       AND COALESCE(s.shift,'') LIKE '%例假%'
  )
ON CONFLICT (employee_id, ot_date) WHERE source = 'holiday_makeup' DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
