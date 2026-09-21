-- ============================================================
-- Security patch: fix secure_advance_workflow_step
--
-- H-1: Self-approval guard now compares by employee UUID (started_by_id)
--      instead of display name — prevents same-name bypass.
-- H-2: Step/instance lookup is scoped to caller's organization_id —
--      prevents cross-tenant approval of another org's workflow steps.
--      (SECURITY DEFINER bypasses RLS, so the org filter must be explicit.)
-- Also: add organization_id column to workflow_instances (needed for M-4
--       writeBackStatus org scoping in workflowIntegration.js).
-- ============================================================

BEGIN;

-- Add organization_id to workflow_instances (idempotent)
ALTER TABLE public.workflow_instances
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id);

-- Patch secure_advance_workflow_step
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
  v_caller_id    UUID;
  v_caller_name  TEXT;
  v_step_row     RECORD;
  v_caller_role  TEXT;
  v_caller_org   INT;
  v_new_status   TEXT;
  v_rows_updated INT;
BEGIN

  -- 1. Identify caller (prefer auth_user_id, fall back to email)
  SELECT id, name
  INTO   v_caller_id, v_caller_name
  FROM   public.employees
  WHERE  auth_user_id = auth.uid()
     OR  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT  1;

  IF v_caller_name IS NULL THEN
    RAISE EXCEPTION '呼叫者身份無法識別：找不到對應的員工記錄';
  END IF;

  v_caller_role := public.current_employee_role();
  v_caller_org  := public.current_employee_org();

  -- 2. Fetch the step + its workflow instance, scoped to caller's org (H-2)
  SELECT
    t.id              AS step_id,
    t.status          AS step_status,
    t.assignee        AS step_assignee,
    wi.id             AS instance_id,
    wi.started_by     AS instance_started_by,
    wi.started_by_id  AS instance_started_by_id
  INTO v_step_row
  FROM  public.tasks t
  JOIN  public.workflow_instances wi ON wi.id = t.workflow_instance_id
  WHERE t.id     = p_step_id
    AND t.status = '待處理'
    AND (
      v_caller_role IN ('admin', 'super_admin')
      OR t.organization_id  = v_caller_org
      OR wi.organization_id = v_caller_org
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION '步驟不存在或已處理';
  END IF;

  -- 3. Self-approval guard (H-1)
  --    Primary: compare by UUID (immune to name changes or cross-org collisions)
  --    Fallback: compare by name for legacy records without started_by_id
  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    IF v_step_row.instance_started_by_id IS NOT NULL THEN
      IF v_step_row.instance_started_by_id = v_caller_id THEN
        RAISE EXCEPTION '不得自行核准：申請人不可審核自己的申請';
      END IF;
    ELSIF v_step_row.instance_started_by = v_caller_name THEN
      RAISE EXCEPTION '不得自行核准：申請人不可審核自己的申請';
    END IF;
  END IF;

  -- 4. Assignee guard
  IF v_step_row.step_assignee IS NOT NULL
     AND v_step_row.step_assignee != v_caller_name
     AND v_caller_role NOT IN ('admin', 'super_admin')
  THEN
    RAISE EXCEPTION '不得代替他人審核：您不是本步驟的指定審核人';
  END IF;

  -- 5. Compute new status
  v_new_status := CASE WHEN p_action = '核准' THEN '已完成' ELSE '已退回' END;

  -- 6. UPDATE with optimistic lock
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

  -- 7. Return result
  RETURN jsonb_build_object(
    'confirmed_by', v_caller_name,
    'step_id',      p_step_id,
    'action',       p_action
  );

END;
$$;

GRANT  EXECUTE ON FUNCTION public.secure_advance_workflow_step(INT, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_advance_workflow_step(INT, TEXT, TEXT) FROM anon;

COMMIT;
