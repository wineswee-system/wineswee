-- total_hours 單一真理源:一律用 net_work_hours 算(會吃排班 rest_minutes / 兩頭班休息)
--   病因:打卡當下存的 total_hours 沒吃 rest_minutes → 兩頭班少扣休息(灌大、PT多付)、
--         短班多扣不該扣的休息(灌小、PT少付)。net_work_hours 才是對的。
-- (1) trigger:打卡進/出時,兩隻卡都在 → total_hours = net_work_hours(後續不再歪)
-- (2) 一次性重算既有(2026-06 起、差異>0.05、有完整打卡)——與已在 live 執行的批次一致,重跑無害

CREATE OR REPLACE FUNCTION public._trg_attendance_recompute_hours()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.clock_in IS NOT NULL AND NEW.clock_out IS NOT NULL THEN
    NEW.total_hours := COALESCE(
      public.net_work_hours(NEW.employee_id, NEW.date, NEW.clock_in, NEW.clock_out),
      NEW.total_hours);
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_attendance_recompute_hours ON public.attendance_records;
CREATE TRIGGER trg_attendance_recompute_hours
  BEFORE INSERT OR UPDATE OF clock_in, clock_out, date ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public._trg_attendance_recompute_hours();

-- 一次性重算既有(冪等:只改差異>0.05 的)
UPDATE public.attendance_records ar
   SET total_hours = round(public.net_work_hours(ar.employee_id, ar.date, ar.clock_in, ar.clock_out), 2)
 WHERE ar.date >= '2026-06-01' AND ar.clock_in IS NOT NULL AND ar.clock_out IS NOT NULL
   AND public.net_work_hours(ar.employee_id, ar.date, ar.clock_in, ar.clock_out) IS NOT NULL
   AND ABS(COALESCE(ar.total_hours,0) - public.net_work_hours(ar.employee_id, ar.date, ar.clock_in, ar.clock_out)) > 0.05;
