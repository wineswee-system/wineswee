-- 防呆(治本):整天假 days<=1 不該橫跨 2 個日期(跨午夜夜班 16:00-01:00 請 1 天,常被存成 end=隔天)。
-- BEFORE INSERT 自動把 end_date 收回 start_date,涵蓋所有寫入路徑(web / LIFF / create_leave_request RPC / 直插)。
-- 只在「整天假 + days<=1 + end>start」時動,其他(多日假 days>=2、時數假、end=start)完全不碰。

CREATE OR REPLACE FUNCTION public._normalize_fullday_leave_enddate()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF (NEW.unit = 'day' OR NEW.unit IS NULL)
     AND NEW.days IS NOT NULL AND NEW.days <= 1
     AND NEW.start_date IS NOT NULL AND NEW.end_date IS NOT NULL
     AND NEW.end_date > NEW.start_date THEN
    NEW.end_date := NEW.start_date;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_leave_normalize_fullday_enddate ON public.leave_requests;
CREATE TRIGGER trg_leave_normalize_fullday_enddate
  BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public._normalize_fullday_leave_enddate();
