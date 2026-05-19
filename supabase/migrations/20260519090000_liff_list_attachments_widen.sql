-- ════════════════════════════════════════════════════════════════════════════
-- liff_list_expense_request_attachments 放寬可見對象
-- ────────────────────────────────────────────────────────────────────────────
-- 廠商反饋：「很多簽核的人在 LIFF 看不到附件」
--
-- Root cause (20260427060000 版本)：
--   1. 條件 cs.step_order = v_er.current_step → 只允許「當前那關」簽核人，
--      已簽過的人（current_step 往後推）就看不到了
--   2. _employee_matches_chain_step(emp_id, cs_id) 沒帶 applicant_emp_id
--      第三參數 → applicant_dept_manager 之類動態 target 解不出
--   3. 沒 cover 核銷鏈（settle_chain_id）簽核人
--   4. 沒 cover 加簽人（approval_extra_steps assignee）
--
-- 修法：1:1 重寫 RPC，eligible 條件改成：
--   (1) 申請人本人 OR
--   (2) 主鏈任一 step 的合法簽核者（帶 applicant_emp_id 動態解） OR
--   (3) 核銷鏈任一 step 的合法簽核者 OR
--   (4) 加簽人（approval_extra_steps assignee_id = emp.id）
-- ════════════════════════════════════════════════════════════════════════════

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
  v_eligible boolean := false;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT * INTO v_er FROM public.expense_requests WHERE id = p_request_id;
  IF v_er.id IS NULL OR v_er.organization_id IS DISTINCT FROM emp.organization_id THEN
    RETURN '[]'::json;
  END IF;

  -- (1) 申請人本人
  IF v_er.employee_id = emp.id THEN
    v_eligible := true;
  END IF;

  -- (2) 主鏈任一 step 的合法簽核者（不限當前 step）
  IF NOT v_eligible AND v_er.approval_chain_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.approval_chain_steps cs
       WHERE cs.chain_id = v_er.approval_chain_id
         AND public._employee_matches_chain_step(emp.id, cs.id, v_er.employee_id)
    ) THEN
      v_eligible := true;
    END IF;
  END IF;

  -- (3) 核銷鏈任一 step 的合法簽核者
  IF NOT v_eligible AND v_er.settle_chain_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.approval_chain_steps cs
       WHERE cs.chain_id = v_er.settle_chain_id
         AND public._employee_matches_chain_step(emp.id, cs.id, v_er.employee_id)
    ) THEN
      v_eligible := true;
    END IF;
  END IF;

  -- (4) 加簽人（任何狀態都可以看）
  IF NOT v_eligible THEN
    IF EXISTS (
      SELECT 1 FROM public.approval_extra_steps
       WHERE source_table = 'expense_requests'
         AND source_id = p_request_id
         AND assignee_id = emp.id
    ) THEN
      v_eligible := true;
    END IF;
  END IF;

  IF NOT v_eligible THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(row_to_json(a.*) ORDER BY a.created_at)
    FROM public.expense_request_attachments a
    WHERE a.request_id = p_request_id
  ), '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public.liff_list_expense_request_attachments(text, int) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
