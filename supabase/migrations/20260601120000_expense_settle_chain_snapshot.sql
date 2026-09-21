-- ════════════════════════════════════════════════════════════
-- 核銷鏈快照 — status → 待核銷 時凍結 settle chain steps
-- ════════════════════════════════════════════════════════════
--
-- 問題：expense_settle_chain 之前沒有跟著 chain_snapshot 系統做
--       若事後改 chain 定義，在飛核銷單的顯示和驗證都會被影響
--
-- 解法：
--   1. _snapshot_settle_chain() — 快照函式，動態 target 直接解成 emp_id
--   2. trg_snapshot_expense_settle_chain — AFTER UPDATE 觸發，
--      status 進 待核銷 且 settle_chain_id 設好後立即快照
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. 快照函式 ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._snapshot_settle_chain(
  p_request_id  INT,
  p_chain_id    INT,
  p_employee_id INT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_step            approval_chain_steps;
  v_resolved_emp_id INT;
BEGIN
  IF p_chain_id IS NULL THEN RETURN; END IF;

  -- 重新核銷時清掉舊快照再重建
  DELETE FROM request_chain_snapshots
  WHERE request_type = 'expense_settle' AND request_id = p_request_id;

  FOR v_step IN
    SELECT * FROM approval_chain_steps
    WHERE chain_id = p_chain_id ORDER BY step_order
  LOOP
    -- 動態 target → 解析當下實際簽核人
    IF v_step.target_type IN (
      'applicant_supervisor', 'applicant_dept_manager', 'applicant_section_supervisor'
    ) THEN
      SELECT emp_id INTO v_resolved_emp_id
      FROM resolve_chain_step_approvers(v_step.id, p_employee_id)
      LIMIT 1;
    ELSE
      v_resolved_emp_id := v_step.target_emp_id;
    END IF;

    INSERT INTO public.request_chain_snapshots (
      request_type, request_id, chain_id, step_order,
      label, role_name, target_type,
      target_emp_id, target_role_id, target_dept_id,
      target_store_id, target_section_id
    ) VALUES (
      'expense_settle', p_request_id, p_chain_id, v_step.step_order,
      v_step.label, v_step.role_name, v_step.target_type,
      COALESCE(v_resolved_emp_id, v_step.target_emp_id),
      v_step.target_role_id, v_step.target_dept_id,
      v_step.target_store_id, v_step.target_section_id
    )
    ON CONFLICT (request_type, request_id, step_order) DO UPDATE SET
      chain_id      = EXCLUDED.chain_id,
      label         = EXCLUDED.label,
      role_name     = EXCLUDED.role_name,
      target_type   = EXCLUDED.target_type,
      target_emp_id = EXCLUDED.target_emp_id,
      snapshotted_at = NOW();
  END LOOP;
END $$;


-- ── 2. Trigger function ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public._trg_snapshot_expense_settle_chain()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- status 進入 待核銷，且 settle_chain_id 已被設定
  IF NEW.status = '待核銷'
     AND (OLD.status IS DISTINCT FROM '待核銷' OR OLD.settle_chain_id IS DISTINCT FROM NEW.settle_chain_id)
     AND NEW.settle_chain_id IS NOT NULL THEN
    PERFORM public._snapshot_settle_chain(NEW.id, NEW.settle_chain_id, NEW.employee_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_snapshot_expense_settle_chain ON public.expense_requests;
CREATE TRIGGER trg_snapshot_expense_settle_chain
  AFTER UPDATE ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_snapshot_expense_settle_chain();


-- ── 3. Backfill：補快照現有 待核銷 / 已核銷 單 ──────────────

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, settle_chain_id, employee_id
    FROM public.expense_requests
    WHERE status IN ('待核銷', '已核銷', '核銷已退回')
      AND settle_chain_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.request_chain_snapshots
        WHERE request_type = 'expense_settle' AND request_id = expense_requests.id
      )
  LOOP
    PERFORM public._snapshot_settle_chain(r.id, r.settle_chain_id, r.employee_id);
  END LOOP;
END $$;


COMMIT;

NOTIFY pgrst, 'reload schema';
