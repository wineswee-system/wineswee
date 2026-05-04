-- ============================================================
-- BEFORE UPDATE trigger on tasks: when status flips to '已完成'
-- and the task has approval_chain_id, intercept the update and:
--   1. Run _create_task_confirmations_for_step for step 0
--   2. If any approvers were created → flip the status to '待確認'
--      instead so the chain actually runs
--   3. If no approvers matched (label-only chain) → let it complete
--
-- Without this, the admin web's "完成" button (which does a direct
-- supabase.from('tasks').update({status:'已完成'})) bypasses the
-- chain logic that lives in liff_complete_task_v2 RPC. Tasks with
-- properly-configured chains were jumping straight to '已完成'
-- and the workflow showed 100% before any approver acted.
--
-- After-INSERT/UPDATE on task_confirmations (trg_sync_task_confirmation_status)
-- already advances the chain — that part is unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION public._task_intercept_complete_for_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_count int;
BEGIN
  -- Only act when status flips to '已完成' from something else, on a task with a chain
  IF NEW.status = '已完成'
     AND (OLD.status IS DISTINCT FROM '已完成')
     AND NEW.approval_chain_id IS NOT NULL THEN

    -- Skip if confirmations already exist (chain already running)
    SELECT COUNT(*) INTO v_existing_count
      FROM task_confirmations
     WHERE task_id = NEW.id;

    IF v_existing_count = 0 THEN
      -- Try to create step 0 confirmations
      PERFORM public._create_task_confirmations_for_step(
        NEW.id, NEW.approval_chain_id, 0, NEW.organization_id
      );

      -- Did anyone get added?
      SELECT COUNT(*) INTO v_existing_count
        FROM task_confirmations
       WHERE task_id = NEW.id;

      IF v_existing_count > 0 THEN
        -- Approvers exist → divert to 待確認 (chain takes over from here)
        NEW.status := '待確認';
        NEW.completed_at := NULL;
      END IF;
      -- If still 0 (label-only chain that matched no employees),
      -- let the original UPDATE go through to '已完成'.
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_intercept_complete_for_chain ON public.tasks;
CREATE TRIGGER trg_task_intercept_complete_for_chain
BEFORE UPDATE OF status ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public._task_intercept_complete_for_chain();

NOTIFY pgrst, 'reload schema';
