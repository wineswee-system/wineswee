-- ════════════════════════════════════════════════════════════
-- 簽核鏈進度/PDF：所有 target_type 都顯示實際簽核者名字
-- 2026-05-13
--
-- 問題：簽核鏈設定「申請人部門主管 / 申請人店長 / 特定門市店長」等動態 target，
-- 在 LIFF 簽核進度時間軸、PDF 簽呈、modal 簽核鏈裡只顯示「主管」或 role_name，
-- 沒顯示實際人名（如「張啟達」）。
--
-- 修法：
--   1. 新 helper _chain_step_display_names(step_id, applicant_id) — 對 9 種 target_type
--      全部呼叫 resolve_chain_step_approvers 拿名字 join 成 string
--   2. liff_get_expense_request_chain_status / liff_get_expense_settle_chain_status
--      改用 helper 顯示名字
--   3. 給 web 用：新 RPC get_chain_step_display_names(chain_id, applicant_id)
--      回傳該 chain 各 step 對應的 [{step_order, names}] (給 buildChainBasedSteps 用)
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. helper：把 chain step 解出的名字 join 成顯示字串 ═══
CREATE OR REPLACE FUNCTION public._chain_step_display_names(
  p_chain_step_id    INT,
  p_applicant_emp_id INT
) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_names TEXT;
BEGIN
  SELECT string_agg(emp_name, '、' ORDER BY emp_name)
    INTO v_names
    FROM public.resolve_chain_step_approvers(p_chain_step_id, COALESCE(p_applicant_emp_id, 0));
  RETURN COALESCE(v_names, '');
END;
$$;

GRANT EXECUTE ON FUNCTION public._chain_step_display_names(INT, INT) TO authenticated, anon;


-- ═══ 2. 重寫 liff_get_expense_request_chain_status 用 helper ═══
CREATE OR REPLACE FUNCTION public.liff_get_expense_request_chain_status(
  p_id INT
) RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_record  RECORD;
  v_result  JSON;
BEGIN
  SELECT id, approval_chain_id, current_step, status, reject_reason, employee_id, organization_id
    INTO v_record
    FROM expense_requests
   WHERE id = p_id;

  IF v_record.id IS NULL OR v_record.approval_chain_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT json_agg(
    json_build_object(
      'step_order', s.step_order,
      'label',      COALESCE(s.label, s.role_name, '第' || (s.step_order + 1) || '關'),
      'name',       public._chain_step_display_names(s.id, v_record.employee_id),
      'status', (
        CASE
          WHEN v_record.status = '已退回' AND s.step_order = v_record.current_step THEN 'rejected'
          WHEN v_record.status IN ('已核銷','已核准') THEN 'completed'
          WHEN s.step_order < v_record.current_step THEN 'completed'
          WHEN s.step_order = v_record.current_step AND v_record.status = '申請中' THEN 'current'
          ELSE 'pending'
        END
      ),
      'reject_reason', (
        CASE WHEN v_record.status = '已退回' AND s.step_order = v_record.current_step
             THEN v_record.reject_reason ELSE NULL END
      )
    ) ORDER BY s.step_order
  )
  INTO v_result
  FROM approval_chain_steps s
  WHERE s.chain_id = v_record.approval_chain_id;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.liff_get_expense_request_chain_status(INT)
  TO anon, authenticated;


-- ═══ 3. 重寫 liff_get_expense_settle_chain_status 用 helper ═══
CREATE OR REPLACE FUNCTION public.liff_get_expense_settle_chain_status(
  p_id INT
) RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_record  RECORD;
  v_result  JSON;
BEGIN
  SELECT id, settle_chain_id, settle_current_step, status, settle_reject_reason, employee_id, organization_id
    INTO v_record
    FROM expense_requests
   WHERE id = p_id;

  IF v_record.id IS NULL OR v_record.settle_chain_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT json_agg(
    json_build_object(
      'step_order', s.step_order,
      'label',      COALESCE(s.label, s.role_name, '第' || (s.step_order + 1) || '關'),
      'name',       public._chain_step_display_names(s.id, v_record.employee_id),
      'status', (
        CASE
          WHEN v_record.status = '核銷已退回' AND s.step_order = v_record.settle_current_step THEN 'rejected'
          WHEN v_record.status = '已核銷' THEN 'completed'
          WHEN s.step_order < v_record.settle_current_step THEN 'completed'
          WHEN s.step_order = v_record.settle_current_step AND v_record.status = '待核銷' THEN 'current'
          ELSE 'pending'
        END
      ),
      'reject_reason', (
        CASE WHEN v_record.status = '核銷已退回' AND s.step_order = v_record.settle_current_step
             THEN v_record.settle_reject_reason ELSE NULL END
      )
    ) ORDER BY s.step_order
  )
  INTO v_result
  FROM approval_chain_steps s
  WHERE s.chain_id = v_record.settle_chain_id;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.liff_get_expense_settle_chain_status(INT)
  TO anon, authenticated;


-- ═══ 4. 新 RPC：給 web buildChainBasedSteps 用 ═══
-- 回傳 [{step_order, label, role_name, target_emp_id, names, target_type}]
-- names 是 join 過的顯示字串（多人用「、」連接）
CREATE OR REPLACE FUNCTION public.get_chain_step_display_names(
  p_chain_id         INT,
  p_applicant_emp_id INT
) RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  IF p_chain_id IS NULL THEN RETURN '[]'::json; END IF;

  SELECT json_agg(
    json_build_object(
      'step_order',    s.step_order,
      'label',         COALESCE(s.label, s.role_name, '第' || (s.step_order + 1) || '關'),
      'role_name',     s.role_name,
      'target_type',   s.target_type,
      'target_emp_id', s.target_emp_id,
      'names',         public._chain_step_display_names(s.id, COALESCE(p_applicant_emp_id, 0))
    ) ORDER BY s.step_order
  )
  INTO v_result
  FROM approval_chain_steps s
  WHERE s.chain_id = p_chain_id;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_chain_step_display_names(INT, INT) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
