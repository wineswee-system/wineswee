-- 錄取簽核 階段2c:LIFF 一鍵簽核 — 2026-07-21
-- LIFF 是 line 身分(無 auth.uid()),不能用 advance_offer_approval。做 line 版 wrapper。
-- 為避免簽核邏輯重複飄掉:把核心抽成 _offer_advance(offer,caller,privileged,action,reason),
--   web(advance_offer_approval, auth.uid())/ liff(liff_advance_offer_approval, line)兩 wrapper 共用。
-- 另加 liff_get_offer_detail 給 LIFF 頁顯示 + 判斷是否輪到本人。

-- ── 核心:多把關 + 狀態同步 + 通知(param 化 caller) ──
CREATE OR REPLACE FUNCTION public._offer_advance(p_offer_id int, p_caller_id int, p_privileged bool, p_action text, p_reason text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ol   offer_letters;
  v_step offer_approval_steps;
  v_next offer_approval_steps;
BEGIN
  SELECT * INTO v_ol FROM offer_letters WHERE id = p_offer_id;
  IF v_ol.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_ol.status <> '待審' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED', 'status', v_ol.status);
  END IF;

  SELECT * INTO v_step FROM offer_approval_steps
   WHERE offer_id = p_offer_id AND step_order = COALESCE(v_ol.current_step, 1) AND status = '待審';
  IF v_step.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_ACTIVE_STEP'); END IF;

  -- 多把關:當關簽核人 或 privileged(admin/recruit.manage)
  IF NOT (v_step.approver_id = p_caller_id OR p_privileged) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  IF p_action = 'reject' THEN
    UPDATE offer_approval_steps SET status = '已駁回', decided_at = now(), reason = p_reason WHERE id = v_step.id;
    UPDATE offer_letters SET status = '已駁回', reject_reason = p_reason WHERE id = p_offer_id;
    UPDATE candidates SET stage = '待錄取決定',
           stage_history = COALESCE(stage_history::jsonb,'[]'::jsonb) || jsonb_build_object('stage','待錄取決定','changed_at',now(),'reason','錄取簽核駁回'),
           updated_at = now()
     WHERE id = v_ol.candidate_id;
    PERFORM public._notify_offer_approval(p_offer_id, 'rejected', NULL);
    RETURN json_build_object('ok', true, 'status', '已駁回');

  ELSIF p_action = 'approve' THEN
    UPDATE offer_approval_steps SET status = '已核准', decided_at = now(), reason = p_reason WHERE id = v_step.id;
    SELECT * INTO v_next FROM offer_approval_steps WHERE offer_id = p_offer_id AND step_order = v_step.step_order + 1;
    IF v_next.id IS NOT NULL THEN
      UPDATE offer_letters SET current_step = v_next.step_order WHERE id = p_offer_id;
      PERFORM public._notify_offer_approval(p_offer_id, 'pending', v_next.approver_id);
      RETURN json_build_object('ok', true, 'status', '待審', 'next_step', v_next.step_order);
    ELSE
      UPDATE offer_letters SET status = '已核准', approved_at = now() WHERE id = p_offer_id;
      UPDATE candidates SET stage = '已錄取',
             stage_history = COALESCE(stage_history::jsonb, '[]'::jsonb) || jsonb_build_object('stage', '已錄取', 'changed_at', now())
       WHERE id = v_ol.candidate_id;
      PERFORM public._notify_offer_approval(p_offer_id, 'approved', NULL);
      RETURN json_build_object('ok', true, 'status', '已核准', 'final', true);
    END IF;
  ELSE
    RETURN json_build_object('ok', false, 'error', 'BAD_ACTION');
  END IF;
END $$;

-- ── web wrapper(auth.uid()) ──
CREATE OR REPLACE FUNCTION public.advance_offer_approval(p_offer_id integer, p_action text, p_reason text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller int; v_role text; v_priv bool;
BEGIN
  SELECT e.id, r.name INTO v_caller, v_role FROM employees e LEFT JOIN roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_caller IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  v_priv := v_role IN ('super_admin','admin') OR public.current_employee_has_permission('recruit.manage');
  RETURN public._offer_advance(p_offer_id, v_caller, v_priv, p_action, p_reason);
END $$;

-- ── LIFF wrapper(line 身分;只給 admin bypass,一般人只能簽自己那關) ──
CREATE OR REPLACE FUNCTION public.liff_advance_offer_approval(p_line_user_id text, p_offer_id int, p_action text, p_reason text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller int; v_role text; v_priv bool;
BEGIN
  SELECT me.id INTO v_caller FROM public._liff_resolve_employee(p_line_user_id) me LIMIT 1;
  IF v_caller IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT r.name INTO v_role FROM employees e LEFT JOIN roles r ON r.id = e.role_id WHERE e.id = v_caller;
  v_priv := v_role IN ('super_admin','admin');
  RETURN public._offer_advance(p_offer_id, v_caller, v_priv, p_action, p_reason);
END $$;

-- ── LIFF 查詢:offer 詳情 + 步驟 + 是否輪到本人 ──
CREATE OR REPLACE FUNCTION public.liff_get_offer_detail(p_line_user_id text, p_offer_id int)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller int; v_ol offer_letters; v_is_approver bool; v_can_act bool;
BEGIN
  SELECT me.id INTO v_caller FROM public._liff_resolve_employee(p_line_user_id) me LIMIT 1;
  IF v_caller IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;

  SELECT * INTO v_ol FROM offer_letters WHERE id = p_offer_id;
  IF v_ol.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  -- 是否為此鏈簽核人(能看)
  SELECT EXISTS(SELECT 1 FROM offer_approval_steps WHERE offer_id = p_offer_id AND approver_id = v_caller) INTO v_is_approver;
  IF NOT v_is_approver THEN RETURN json_build_object('ok', false, 'error', 'FORBIDDEN'); END IF;

  -- 是否輪到本人(當前待審關 = 本人)
  SELECT EXISTS(
    SELECT 1 FROM offer_approval_steps
     WHERE offer_id = p_offer_id AND step_order = COALESCE(v_ol.current_step,1)
       AND status = '待審' AND approver_id = v_caller
  ) AND v_ol.status = '待審' INTO v_can_act;

  RETURN json_build_object(
    'ok', true,
    'can_act', v_can_act,
    'offer', jsonb_build_object(
      'id', v_ol.id, 'status', v_ol.status, 'current_step', v_ol.current_step,
      'candidate_name', (SELECT name FROM candidates WHERE id = v_ol.candidate_id),
      'position', v_ol.position, 'dept', v_ol.dept, 'salary', v_ol.salary,
      'start_date', v_ol.start_date, 'probation_days', v_ol.probation_days,
      'reject_reason', v_ol.reject_reason
    ),
    'steps', (
      SELECT COALESCE(json_agg(jsonb_build_object(
        'step_order', s.step_order, 'status', s.status,
        'approver_name', (SELECT name FROM employees WHERE id = s.approver_id),
        'decided_at', s.decided_at, 'reason', s.reason
      ) ORDER BY s.step_order), '[]'::json)
      FROM offer_approval_steps s WHERE s.offer_id = p_offer_id
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public._offer_advance(int, int, bool, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_offer_approval(integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liff_advance_offer_approval(text, int, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.liff_get_offer_detail(text, int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
