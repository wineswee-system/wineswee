-- ════════════════════════════════════════════════════════════
-- 讓 approver 也能看申請的附件 (照片/檔案)
-- ────────────────────────────────────────────────────────────
-- 舊版 liff_list_expense_request_attachments 只允許申請人本人讀
-- → 簽核者無法看到申請人附的證明照片/單據
-- 修法：允許「申請人本人」OR「當前 chain step 的合法簽核者」
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.liff_list_expense_request_attachments(
  p_line_user_id text,
  p_request_id   int
)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp        employees;
  v_er       record;
  v_eligible boolean;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT * INTO v_er FROM public.expense_requests WHERE id = p_request_id;
  IF v_er.id IS NULL OR v_er.organization_id IS DISTINCT FROM emp.organization_id THEN
    RETURN '[]'::json;
  END IF;

  -- 條件：(1) 申請人本人 OR (2) 當前 chain step 的合法簽核者
  v_eligible := (v_er.employee_id = emp.id) OR (
    v_er.approval_chain_id IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM public.approval_chain_steps cs
       WHERE cs.chain_id = v_er.approval_chain_id
         AND cs.step_order = v_er.current_step
         AND public._employee_matches_chain_step(emp.id, cs.id)
    )
  );

  IF NOT v_eligible THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(row_to_json(a.*) ORDER BY a.created_at)
    FROM public.expense_request_attachments a
    WHERE a.request_id = p_request_id
  ), '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_expense_request_attachments(text, int) TO authenticated, anon;

COMMIT;
