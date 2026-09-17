
-- clock_corrections:當前簽核人可看(frozen-aware)
DROP POLICY IF EXISTS clock_corrections_approver_sel ON public.clock_corrections;
CREATE POLICY clock_corrections_approver_sel ON public.clock_corrections FOR SELECT
USING (public._emp_is_current_step_approver(public.current_employee_id(),'correction',id,approval_chain_id,current_step,employee_id));

-- expense_requests:核准鏈 + 核銷鏈 當前簽核人可看(frozen-aware)
DROP POLICY IF EXISTS expense_requests_chain_approver_sel ON public.expense_requests;
CREATE POLICY expense_requests_chain_approver_sel ON public.expense_requests FOR SELECT
USING (
  (approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(public.current_employee_id(),'expense_request',id,approval_chain_id,current_step,employee_id))
  OR (settle_chain_id IS NOT NULL AND public._emp_is_current_step_approver(public.current_employee_id(),'expense_settle',id,settle_chain_id,settle_current_step,employee_id))
);

DROP POLICY IF EXISTS leave_requests_approver_sel ON public.leave_requests;
CREATE POLICY leave_requests_approver_sel ON public.leave_requests FOR SELECT
USING (approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(public.current_employee_id(),'leave_request',id,approval_chain_id,current_step,employee_id));
DROP POLICY IF EXISTS overtime_requests_approver_sel ON public.overtime_requests;
CREATE POLICY overtime_requests_approver_sel ON public.overtime_requests FOR SELECT
USING (approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(public.current_employee_id(),'overtime_request',id,approval_chain_id,current_step,employee_id));
DROP POLICY IF EXISTS business_trips_approver_sel ON public.business_trips;
CREATE POLICY business_trips_approver_sel ON public.business_trips FOR SELECT
USING (approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(public.current_employee_id(),'trip',id,approval_chain_id,current_step,employee_id));
DROP POLICY IF EXISTS resignation_requests_approver_sel ON public.resignation_requests;
CREATE POLICY resignation_requests_approver_sel ON public.resignation_requests FOR SELECT
USING (approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(public.current_employee_id(),'resignation',id,approval_chain_id,current_step,employee_id));
DROP POLICY IF EXISTS leave_of_absence_requests_approver_sel ON public.leave_of_absence_requests;
CREATE POLICY leave_of_absence_requests_approver_sel ON public.leave_of_absence_requests FOR SELECT
USING (approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(public.current_employee_id(),'loa',id,approval_chain_id,current_step,employee_id));
DROP POLICY IF EXISTS personnel_transfer_requests_approver_sel ON public.personnel_transfer_requests;
CREATE POLICY personnel_transfer_requests_approver_sel ON public.personnel_transfer_requests FOR SELECT
USING (approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(public.current_employee_id(),'transfer',id,approval_chain_id,current_step,employee_id));
DROP POLICY IF EXISTS headcount_requests_approver_sel ON public.headcount_requests;
CREATE POLICY headcount_requests_approver_sel ON public.headcount_requests FOR SELECT
USING (approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(public.current_employee_id(),'headcount',id,approval_chain_id,current_step,employee_id));
DROP POLICY IF EXISTS expenses_approver_sel ON public.expenses;
CREATE POLICY expenses_approver_sel ON public.expenses FOR SELECT
USING (approval_chain_id IS NOT NULL AND public._emp_is_current_step_approver(public.current_employee_id(),'expense',id,approval_chain_id,current_step,employee_id));
DROP POLICY IF EXISTS form_submissions_approver_sel ON public.form_submissions;
CREATE POLICY form_submissions_approver_sel ON public.form_submissions FOR SELECT
USING (public._emp_is_current_step_approver(public.current_employee_id(),'form_submission',id,(SELECT ft.approval_chain_id FROM public.form_templates ft WHERE ft.id=template_id),current_step,applicant_id));
