-- ============================================================
-- New RPC: resume_workflow_for_request
--
-- Companion to liff_resubmit_request, intended for the web admin
-- frontend (uses auth.uid() instead of LINE user id).
--
-- Called AFTER the frontend has already UPDATEd the request table
-- (status back to in-progress, fields edited, line items rewritten).
-- This RPC just re-arms the workflow side:
--   1. Find the workflow_instance for this request
--   2. Reset rejected step's task → 進行中 (trigger fires LINE push)
--   3. Reset workflow_instance.status → 進行中
--
-- Auth: SECURITY DEFINER, identifies caller by auth.uid(); applicant
-- can only resume their OWN workflow (rejected applicant identity must
-- match started_by_id / started_by).
-- ============================================================

CREATE OR REPLACE FUNCTION public.resume_workflow_for_request(
  p_type text,
  p_id   int
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp             employees;
  v_template_name text;
  v_instance_id   int;
  v_resumed_count int := 0;
BEGIN
  -- 1. Identify caller via auth context
  SELECT * INTO emp
    FROM public.employees
   WHERE auth_user_id = auth.uid()
      OR email = auth.jwt() ->> 'email'
   ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST
   LIMIT 1;

  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'CALLER_NOT_FOUND');
  END IF;

  -- 2. Map type → template_name (correction has no workflow)
  v_template_name := CASE p_type
    WHEN 'leave'           THEN '請假簽核'
    WHEN 'overtime'        THEN '加班簽核'
    WHEN 'trip'            THEN '出差申請簽核'
    WHEN 'expense'         THEN '費用報帳簽核'
    WHEN 'expense_request' THEN '費用申請簽核'
    ELSE NULL
  END;

  IF v_template_name IS NULL THEN
    -- correction or unknown type — nothing to resume, treat as success
    RETURN json_build_object('ok', true, 'instance_id', NULL, 'resumed_tasks', 0);
  END IF;

  -- 3. Find the workflow_instance, scoped to caller's org + ownership
  IF p_type = 'expense_request' THEN
    SELECT workflow_instance_id INTO v_instance_id
      FROM expense_requests
     WHERE id = p_id
       AND organization_id = emp.organization_id
       AND (employee_id = emp.id OR employee = emp.name);
  ELSE
    SELECT wi.id INTO v_instance_id
      FROM workflow_instances wi
     WHERE wi.template_name = v_template_name
       AND wi.organization_id = emp.organization_id
       AND (wi.started_by_id = emp.id OR wi.started_by = emp.name)
     ORDER BY wi.started_at DESC
     LIMIT 1;
  END IF;

  IF v_instance_id IS NULL THEN
    -- No workflow_instance — request might have been created before
    -- workflow integration. Treat as benign success.
    RETURN json_build_object('ok', true, 'instance_id', NULL, 'resumed_tasks', 0);
  END IF;

  -- 4. Re-arm: bump rejected step → 進行中, reset workflow_instance
  UPDATE public.tasks
     SET status       = '進行中',
         confirmed    = false,
         confirmed_by = NULL,
         confirmed_at = NULL,
         notes        = NULL,
         completed_at = NULL
   WHERE workflow_instance_id = v_instance_id
     AND status = '已退回';
  GET DIAGNOSTICS v_resumed_count = ROW_COUNT;

  UPDATE public.workflow_instances
     SET status = '進行中',
         completed_at = NULL
   WHERE id = v_instance_id
     AND status IN ('已退回', '進行中');

  RETURN json_build_object(
    'ok',            true,
    'instance_id',   v_instance_id,
    'resumed_tasks', v_resumed_count
  );
END $$;

GRANT EXECUTE ON FUNCTION public.resume_workflow_for_request(text, int) TO authenticated;

NOTIFY pgrst, 'reload schema';
