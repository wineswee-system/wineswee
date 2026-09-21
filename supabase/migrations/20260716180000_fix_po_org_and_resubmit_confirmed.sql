-- 修 schema 漂移壞函式:採購單 org + 退回重送/流程恢復 — 2026-07-16
--   1. secure_create_purchase_order:INSERT purchase_orders(organization_id) 但該表無此欄
--      → 補 organization_id 欄 + 回填(既有 2 筆歸 org 1)。函式定義不用改,補欄即通。
--   2. liff_resubmit_request / resume_workflow_for_request:UPDATE tasks SET confirmed/
--      confirmed_by/confirmed_at(tasks 無此三欄,確認狀態在 task_confirmations)→ 從 SET 拿掉,
--      保留 notes=NULL(tasks 有 notes)。
-- idempotent。

-- 1. purchase_orders 補 org
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id);
UPDATE public.purchase_orders SET organization_id = 1 WHERE organization_id IS NULL;

-- 2. 兩支函式(已砍掉 tasks 不存在的 confirmed 三欄)
CREATE OR REPLACE FUNCTION public.liff_resubmit_request(p_line_user_id text, p_type text, p_id integer, p_changes jsonb DEFAULT NULL::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp employees;
  n int;
  v_template_name text;
  v_instance_id   int;
  v_resumed_count int := 0;
BEGIN
  -- 1. Resolve employee
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 2. Type-specific UPDATE on the request table
  IF p_type = 'leave' THEN
    UPDATE leave_requests
       SET status = '待審核', reject_reason = NULL,
           reason     = COALESCE(p_changes->>'reason', reason),
           start_date = COALESCE((p_changes->>'start_date')::date, start_date),
           end_date   = COALESCE((p_changes->>'end_date')::date, end_date),
           hours      = COALESCE((p_changes->>'hours')::numeric, hours)
     WHERE id = p_id
       AND status IN ('已退回', '已拒絕')
       AND (employee_id = emp.id OR employee = emp.name)
       AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_template_name := '請假簽核';

  ELSIF p_type = 'overtime' THEN
    UPDATE overtime_requests
       SET status = '待審核', reject_reason = NULL,
           reason = COALESCE(p_changes->>'reason', reason),
           date   = COALESCE((p_changes->>'date')::date, date),
           hours  = COALESCE((p_changes->>'hours')::numeric, hours)
     WHERE id = p_id
       AND status IN ('已退回', '已拒絕')
       AND (employee_id = emp.id OR employee = emp.name)
       AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_template_name := '加班簽核';

  ELSIF p_type = 'trip' THEN
    UPDATE business_trips SET status = '待審核', reject_reason = NULL
     WHERE id = p_id
       AND status IN ('已退回', '已駁回')
       AND employee = emp.name
       AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_template_name := '出差申請簽核';

  ELSIF p_type = 'correction' THEN
    UPDATE clock_corrections SET status = '待審核', reject_reason = NULL
     WHERE id = p_id
       AND status IN ('已退回', '已駁回')
       AND employee = emp.name;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_template_name := NULL;

  ELSIF p_type = 'expense' THEN
    UPDATE expenses SET status = '待審核', reject_reason = NULL
     WHERE id = p_id
       AND status IN ('已退回', '已駁回')
       AND employee = emp.name;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_template_name := '費用報帳簽核';

  ELSIF p_type = 'expense_request' THEN
    UPDATE expense_requests
       SET status = '申請中', reject_reason = NULL
     WHERE id = p_id
       AND status IN ('已退回', '已駁回')
       AND employee = emp.name
       AND organization_id = emp.organization_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    v_template_name := '費用申請簽核';

  ELSE
    RETURN json_build_object('ok', false, 'error', 'INVALID_TYPE');
  END IF;

  IF n = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_NOT_REJECTED');
  END IF;

  -- 3. Re-arm the workflow (skip when no template, e.g. correction)
  IF v_template_name IS NOT NULL THEN
    IF p_type = 'expense_request' THEN
      SELECT workflow_instance_id INTO v_instance_id
        FROM expense_requests WHERE id = p_id;
    ELSE
      SELECT id INTO v_instance_id
        FROM workflow_instances
       WHERE template_name = v_template_name
         AND organization_id = emp.organization_id
         AND (started_by_id = emp.id OR started_by = emp.name)
       ORDER BY started_at DESC
       LIMIT 1;
    END IF;

    IF v_instance_id IS NOT NULL THEN
      UPDATE tasks
         SET status = '進行中',
             notes = NULL,
             completed_at = NULL
       WHERE workflow_instance_id = v_instance_id
         AND status = '已退回';
      GET DIAGNOSTICS v_resumed_count = ROW_COUNT;

      UPDATE workflow_instances
         SET status = '進行中',
             completed_at = NULL
       WHERE id = v_instance_id
         AND status IN ('已退回', '進行中');
    END IF;
  END IF;

  RETURN json_build_object(
    'ok',            true,
    'instance_id',   v_instance_id,
    'resumed_tasks', v_resumed_count
  );
END $function$
;

CREATE OR REPLACE FUNCTION public.resume_workflow_for_request(p_type text, p_id integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;

NOTIFY pgrst, 'reload schema';
