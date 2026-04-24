-- Migration: 20260424300001_secure_advance_workflow_step
-- Purpose: SECURITY DEFINER function that enforces caller-level authorization
--          before advancing a workflow step.  Replaces the direct tasks-table
--          UPDATE in src/lib/workflowIntegration.js advanceWorkflow() (lines 139-158).

BEGIN;

-- current_employee_role() already defined in 20260424100100_security_hardening.sql
-- (JOINs roles table via employees.role_id). No redefinition needed here.

-- ---------------------------------------------------------------------------
-- Main function: secure_advance_workflow_step
--
-- Parameters:
--   p_step_id  INT   — tasks.id of the step to advance
--   p_action   TEXT  — '核准' to approve; any other value rejects ('已退回')
--   p_comment  TEXT  — optional notes / rejection reason
--
-- Returns: JSONB { confirmed_by, step_id, action }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.secure_advance_workflow_step(
  p_step_id  INT,
  p_action   TEXT,
  p_comment  TEXT DEFAULT NULL
)
  RETURNS JSONB
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id   UUID;
  v_caller_name TEXT;
  v_step_row    RECORD;   -- holds columns from tasks JOIN workflow_instances
  v_caller_role TEXT;
  v_new_status  TEXT;
  v_rows_updated INT;
BEGIN

  -- -------------------------------------------------------------------------
  -- 1. Identify caller
  --    Match by auth_user_id first; fall back to email lookup for providers
  --    that store the UID differently.
  -- -------------------------------------------------------------------------
  SELECT id, name
  INTO   v_caller_id, v_caller_name
  FROM   public.employees
  WHERE  auth_user_id = auth.uid()
     OR  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  LIMIT  1;

  IF v_caller_name IS NULL THEN
    RAISE EXCEPTION '呼叫者身份無法識別：找不到對應的員工記錄';
  END IF;

  -- -------------------------------------------------------------------------
  -- 2. Fetch the step AND its workflow instance in one query.
  --    The step must still be in '待處理' state.
  -- -------------------------------------------------------------------------
  SELECT
    t.id            AS step_id,
    t.status        AS step_status,
    t.assignee      AS step_assignee,
    wi.id           AS instance_id,
    wi.started_by   AS instance_started_by
  INTO v_step_row
  FROM  public.tasks t
  JOIN  public.workflow_instances wi ON wi.id = t.workflow_instance_id
  WHERE t.id     = p_step_id
    AND t.status = '待處理'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION '步驟不存在或已處理';
  END IF;

  -- -------------------------------------------------------------------------
  -- 3. Self-approval guard
  --    The person who started the workflow instance cannot approve its steps
  --    unless they hold admin / super_admin role.
  -- -------------------------------------------------------------------------
  v_caller_role := public.current_employee_role();

  IF v_step_row.instance_started_by = v_caller_name
     AND v_caller_role NOT IN ('admin', 'super_admin')
  THEN
    RAISE EXCEPTION '不得自行核准：申請人不可審核自己的申請';
  END IF;

  -- -------------------------------------------------------------------------
  -- 4. Assignee guard
  --    If the step has a designated reviewer, only that reviewer (or an admin)
  --    may act on it.
  -- -------------------------------------------------------------------------
  IF v_step_row.step_assignee IS NOT NULL
     AND v_step_row.step_assignee != v_caller_name
     AND v_caller_role NOT IN ('admin', 'super_admin')
  THEN
    RAISE EXCEPTION '不得代替他人審核：您不是本步驟的指定審核人';
  END IF;

  -- -------------------------------------------------------------------------
  -- 5. Compute new status
  -- -------------------------------------------------------------------------
  v_new_status := CASE WHEN p_action = '核准' THEN '已完成' ELSE '已退回' END;

  -- -------------------------------------------------------------------------
  -- 6. UPDATE with optimistic lock
  --    Re-assert status = '待處理' in the WHERE clause so a concurrent call
  --    that already flipped the row will yield 0 rows and be caught below.
  -- -------------------------------------------------------------------------
  UPDATE public.tasks
  SET
    status       = v_new_status,
    confirmed    = (p_action = '核准'),
    confirmed_by = v_caller_name,
    confirmed_at = now(),
    notes        = p_comment,
    completed_at = CASE WHEN p_action = '核准' THEN now() ELSE NULL END
  WHERE id     = p_step_id
    AND status = '待處理';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION 'step_already_processed';
  END IF;

  -- -------------------------------------------------------------------------
  -- 7. Return result
  -- -------------------------------------------------------------------------
  RETURN jsonb_build_object(
    'confirmed_by', v_caller_name,
    'step_id',      p_step_id,
    'action',       p_action
  );

END;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
GRANT  EXECUTE ON FUNCTION public.secure_advance_workflow_step(INT, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_advance_workflow_step(INT, TEXT, TEXT) FROM anon;

COMMIT;
