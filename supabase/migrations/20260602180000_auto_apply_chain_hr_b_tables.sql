-- HR B 表（離職/異動/留停）補掛 _auto_apply_hr_form_chain trigger
-- 讓 chain 由 DB 決定，不靠前端傳入

-- resignation_requests
DROP TRIGGER IF EXISTS trg_auto_apply_chain_resignation ON public.resignation_requests;
CREATE TRIGGER trg_auto_apply_chain_resignation
  BEFORE INSERT ON public.resignation_requests
  FOR EACH ROW EXECUTE FUNCTION _auto_apply_hr_form_chain('resignation');

-- personnel_transfer_requests
DROP TRIGGER IF EXISTS trg_auto_apply_chain_transfer ON public.personnel_transfer_requests;
CREATE TRIGGER trg_auto_apply_chain_transfer
  BEFORE INSERT ON public.personnel_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION _auto_apply_hr_form_chain('transfer');

-- leave_of_absence_requests
DROP TRIGGER IF EXISTS trg_auto_apply_chain_loa ON public.leave_of_absence_requests;
CREATE TRIGGER trg_auto_apply_chain_loa
  BEFORE INSERT ON public.leave_of_absence_requests
  FOR EACH ROW EXECUTE FUNCTION _auto_apply_hr_form_chain('loa');
