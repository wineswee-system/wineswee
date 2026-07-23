-- 經常性費用(expenses)補簽核鏈快照 + LIFF「我的簽核進度」認 expense — 2026-07-23
-- ════════════════════════════════════════════════════════════════════════════
-- 問題:經常性費用申請(expenses 表,type='expense')在 LIFF「我的簽核進度」看不到簽核鏈。
-- 根因:簽核快照 rollout 漏掉 expenses → ①沒 snapshot trigger(只有 expense_request/settle)
--       ②liff_get_request_chain 的 CASE 沒 'expense' 分支。ASH 已有 expense(15筆)→只差快照。
-- 修法(比照 expense_request,不改既有函式):
--   A. 新增 _trg_snapshot_expense_chain + trigger(冪等,_snapshot_chain_for_request 有 ON CONFLICT)
--   B. 回填現有有 chain 的 expenses
--   C. liff_get_request_chain 加 'expense' 分支(其餘 body 與 live 逐字一致)
-- ════════════════════════════════════════════════════════════════════════════

-- ── A. 快照 trigger(比照 _trg_snapshot_expense_request_chain,rt='expense',帶申請人啟用 auto-skip) ──
CREATE OR REPLACE FUNCTION public._trg_snapshot_expense_chain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.approval_chain_id IS DISTINCT FROM NEW.approval_chain_id THEN
    DELETE FROM public.request_chain_snapshots WHERE request_type = 'expense' AND request_id = NEW.id;
  END IF;
  PERFORM public._snapshot_chain_for_request('expense', NEW.id, NEW.approval_chain_id, NEW.employee_id);
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_snapshot_expense_chain ON public.expenses;
CREATE TRIGGER trg_snapshot_expense_chain
  AFTER INSERT OR UPDATE OF approval_chain_id ON public.expenses
  FOR EACH ROW
  WHEN (NEW.approval_chain_id IS NOT NULL)
  EXECUTE FUNCTION public._trg_snapshot_expense_chain();

-- ── B. 回填現有有 chain 的 expenses(冪等,ON CONFLICT DO NOTHING) ──
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, approval_chain_id, employee_id FROM public.expenses WHERE approval_chain_id IS NOT NULL LOOP
    PERFORM public._snapshot_chain_for_request('expense', r.id, r.approval_chain_id, r.employee_id);
  END LOOP;
END $$;

-- ── C. liff_get_request_chain 加 'expense' 分支(其餘與 20260717190000 逐字一致) ──
CREATE OR REPLACE FUNCTION public.liff_get_request_chain(p_type text, p_id integer)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_snap_type text;
  v_applicant int;
  v_status    text;
  v_approved  boolean;
  v_result json;
BEGIN
  -- snapshot 的 request_type(長名)
  v_snap_type := CASE p_type
    WHEN 'leave'    THEN 'leave_request'
    WHEN 'overtime' THEN 'overtime_request'
    ELSE p_type
  END;

  -- 申請人 employee_id + 單子最終狀態(依 request_type 對應表)
  CASE p_type
    WHEN 'leave'           THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.leave_requests     WHERE id = p_id;
    WHEN 'overtime'        THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.overtime_requests  WHERE id = p_id;
    WHEN 'correction'      THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.clock_corrections  WHERE id = p_id;
    WHEN 'trip'            THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.business_trips      WHERE id = p_id;
    WHEN 'expense_request' THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.expense_requests   WHERE id = p_id;
    WHEN 'expense'         THEN SELECT employee_id, status INTO v_applicant, v_status FROM public.expenses           WHERE id = p_id;
    ELSE v_applicant := NULL;
  END CASE;

  -- 已核准/通過 → 所有關卡視為 completed(current_step 舊單不可靠,只信最終狀態)
  v_approved := v_status IN ('已核准', '已通過', '已核銷', '已結案');

  SELECT json_agg(row_to_json(x) ORDER BY x.step_order) INTO v_result FROM (
    SELECT
      s.step_order,
      s.label,
      COALESCE(
        h.approver_name,  -- 已簽關:實際簽核人
        (SELECT string_agg(r.emp_name, '、')
           FROM public.resolve_snapshot_step_approvers(v_snap_type, p_id, s.step_order, v_applicant) r)  -- 未到關:現任
      ) AS name,
      CASE
        WHEN v_approved THEN 'completed'
        WHEN h.action IN ('rejected','returned','退回','駁回') THEN 'rejected'
        WHEN h.exited_at IS NOT NULL THEN 'completed'
        WHEN h.entered_at IS NOT NULL THEN 'current'
        ELSE 'pending'
      END AS status,
      h.notes AS reject_reason
    FROM public.request_chain_snapshots s
    LEFT JOIN LATERAL (
      SELECT hh.* FROM public.approval_step_history hh
       WHERE hh.request_type = p_type AND hh.request_id = p_id AND hh.step_order = s.step_order
       ORDER BY hh.entered_at DESC LIMIT 1   -- 取最新一筆(重工/退回會有多筆)
    ) h ON true
    WHERE s.request_type = v_snap_type AND s.request_id = p_id
      AND COALESCE(s.auto_skipped, false) = false
  ) x;

  RETURN COALESCE(v_result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_get_request_chain(text, integer) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
