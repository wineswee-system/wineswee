-- 修正 _auto_apply_hr_form_chain trigger：補上 form_type 參數
-- 原本建立時沒傳參數，TG_ARGV[0] = NULL，chain 永遠查不到

-- leave_requests
DROP TRIGGER IF EXISTS trg_auto_apply_chain_leave ON public.leave_requests;
CREATE TRIGGER trg_auto_apply_chain_leave
  BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION _auto_apply_hr_form_chain('leave');

-- overtime_requests
DROP TRIGGER IF EXISTS trg_auto_apply_chain_overtime ON public.overtime_requests;
CREATE TRIGGER trg_auto_apply_chain_overtime
  BEFORE INSERT ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION _auto_apply_hr_form_chain('overtime');

-- business_trips
DROP TRIGGER IF EXISTS trg_auto_apply_chain_trip ON public.business_trips;
CREATE TRIGGER trg_auto_apply_chain_trip
  BEFORE INSERT ON public.business_trips
  FOR EACH ROW EXECUTE FUNCTION _auto_apply_hr_form_chain('trip');

-- clock_corrections
DROP TRIGGER IF EXISTS trg_auto_apply_chain_correction ON public.clock_corrections;
CREATE TRIGGER trg_auto_apply_chain_correction
  BEFORE INSERT ON public.clock_corrections
  FOR EACH ROW EXECUTE FUNCTION _auto_apply_hr_form_chain('correction');

-- expenses
DROP TRIGGER IF EXISTS trg_auto_apply_chain_expense ON public.expenses;
CREATE TRIGGER trg_auto_apply_chain_expense
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION _auto_apply_hr_form_chain('expense');
