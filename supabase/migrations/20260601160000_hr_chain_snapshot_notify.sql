-- ════════════════════════════════════════════════════════════════════════════
-- HR chain LINE 通知切快照
-- 2026-06-01
--
-- 接續 20260601150000（HR approve RPC 切快照）— 把 LINE 通知一起切。
--
-- 範圍：
--   - HR B `_notify_hr_b_step`（resignation/transfer/loa/headcount）— 改 snapshot 優先
--   - HR A 通知（leave/overtime/trip/correction/expense）— 維持現狀
--     原因：HR A notify 走 `_resolve_hr_approver_ids` 組織圖（不讀 chain），
--           不受 chain 改動影響，沒切換必要。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._notify_hr_b_step(
  p_table       text,    -- 'resignation' | 'transfer' | 'loa' | 'headcount'
  p_id          int,
  p_step_order  int
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_chain_id          int;
  v_emp_id            int;
  v_snap_request_type text;
  v_step              approval_chain_steps;
  v_has_snapshot      boolean;
  v_count             int := 0;
  v_line              record;
BEGIN
  v_snap_request_type := p_table;  -- 'resignation' / 'transfer' / 'loa' / 'headcount' 對齊

  EXECUTE format(
    'SELECT approval_chain_id, employee_id FROM %I WHERE id = $1',
    CASE p_table
      WHEN 'resignation' THEN 'resignation_requests'
      WHEN 'transfer'    THEN 'personnel_transfer_requests'
      WHEN 'loa'         THEN 'leave_of_absence_requests'
      WHEN 'headcount'   THEN 'headcount_requests'
    END
  ) INTO v_chain_id, v_emp_id USING p_id;

  IF v_chain_id IS NULL THEN RETURN 0; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = v_snap_request_type AND request_id = p_id
  ) INTO v_has_snapshot;

  -- ── snapshot 優先 ──
  IF v_has_snapshot THEN
    FOR v_line IN
      SELECT DISTINCT v.line_user_id, v.liff_id
        FROM public.resolve_snapshot_step_approvers(
               v_snap_request_type, p_id, p_step_order, v_emp_id
             ) a
        JOIN public.v_employee_line_resolved v
          ON v.employee_id = a.emp_id AND v.line_user_id = a.line_user_id
       WHERE v.line_user_id IS NOT NULL
    LOOP
      IF p_table = 'resignation' THEN
        PERFORM public._push_resignation_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
      ELSIF p_table = 'transfer' THEN
        PERFORM public._push_transfer_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
      ELSIF p_table = 'loa' THEN
        PERFORM public._push_loa_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
      ELSIF p_table = 'headcount' THEN
        PERFORM public._push_headcount_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
      END IF;
      v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
  END IF;

  -- ── 沒快照（舊單）→ fallback live chain ──
  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = p_step_order;
  IF v_step.id IS NULL THEN RETURN 0; END IF;

  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
      FROM public.resolve_chain_step_approvers(v_step.id, v_emp_id) a
      JOIN public.v_employee_line_resolved v
        ON v.employee_id = a.emp_id AND v.line_user_id = a.line_user_id
     WHERE v.line_user_id IS NOT NULL
  LOOP
    IF p_table = 'resignation' THEN
      PERFORM public._push_resignation_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_table = 'transfer' THEN
      PERFORM public._push_transfer_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_table = 'loa' THEN
      PERFORM public._push_loa_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_table = 'headcount' THEN
      PERFORM public._push_headcount_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public._notify_hr_b_step(text, int, int) TO authenticated, service_role;

COMMENT ON FUNCTION public._notify_hr_b_step(text, int, int) IS
  'HR B chain LINE 通知 — snapshot 優先（2026-06-01）';

COMMIT;
NOTIFY pgrst, 'reload schema';
