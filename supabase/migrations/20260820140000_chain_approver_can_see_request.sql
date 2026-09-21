-- 修:人事異動(personnel_transfer)簽核人在 web 看不到單(純顯示問題,簽核鏈/路由都正常)。
-- 原因:SELECT RLS 是 can_see_request(employee_id) → 只放行「申請人的主管鏈/店長/admin」,
--   不放行「簽核鏈上的簽核人」。人事異動走「行政人員簽核鏈」(如人資主管 張啟達,非申請人主管)
--   → 簽核人收得到 LINE(簽核鏈另發)但 web 直查被 RLS 擋、只有表單查詢(走 DEFINER RPC)看得到。
-- 修法(加新 policy,不動 can_see_request):簽核鏈快照 frozen_emp_ids 內含我 → 可看該單。
-- 與 expense_requests/business_trips/expenses 早有的 *_approver_sel 同款(它們沒中招因為早就補了);此處只補漏掉的 transfer。
-- 註:leave/overtime/trip/correction 簽核人=主管本來就通;離職經確認沒問題,不動。

CREATE OR REPLACE FUNCTION public._is_request_chain_approver(p_request_type text, p_request_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.request_chain_snapshots s
     WHERE s.request_type = p_request_type
       AND s.request_id   = p_request_id
       AND (SELECT public.current_employee_id()) = ANY (s.frozen_emp_ids)
  );
$function$;

-- 人事異動
DROP POLICY IF EXISTS personnel_transfer_requests_approver_sel ON public.personnel_transfer_requests;
CREATE POLICY personnel_transfer_requests_approver_sel ON public.personnel_transfer_requests
  FOR SELECT USING (public._is_request_chain_approver('transfer', id));
