-- 錄取簽核「加簽」— 在還沒簽的關之後插入一位簽核人（中間插入）— 2026-07-21
-- 核心 _offer_add_signer(offer,caller,privileged,approver,after_step) 抽出,web/liff 兩 wrapper 共用。
-- 規則:只在 offer '待審' 時可加;只能插在 >= 當前關(不能塞進已簽的段);插入後其後所有關 step_order +1。
-- 新關在當前關之後 → current_step 指標不變;輪到它時由 advance 的推進通知發卡。
-- 把關:當關簽核人 / admin(web 另含 recruit.manage)。純加新 RPC。

CREATE OR REPLACE FUNCTION public._offer_add_signer(
  p_offer_id int, p_caller_id int, p_privileged bool, p_approver_id int, p_after_step int
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ol      offer_letters;
  v_cur     int;
  v_total   int;
  v_new_ord int;
  v_is_step_approver bool;
BEGIN
  IF p_approver_id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NO_APPROVER'); END IF;

  SELECT * INTO v_ol FROM offer_letters WHERE id = p_offer_id;
  IF v_ol.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_ol.status <> '待審' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING', 'status', v_ol.status);
  END IF;

  v_cur := COALESCE(v_ol.current_step, 1);
  SELECT count(*) INTO v_total FROM offer_approval_steps WHERE offer_id = p_offer_id;

  -- 把關:當關簽核人 或 privileged
  SELECT EXISTS(
    SELECT 1 FROM offer_approval_steps
     WHERE offer_id = p_offer_id AND step_order = v_cur AND status = '待審' AND approver_id = p_caller_id
  ) INTO v_is_step_approver;
  IF NOT (v_is_step_approver OR p_privileged) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  -- 位置把關:只能插在「當前關之後」到「最後一關」之間(不能插進已簽的段)
  IF p_after_step < v_cur OR p_after_step > v_total THEN
    RETURN json_build_object('ok', false, 'error', 'BAD_POSITION', 'current', v_cur, 'total', v_total);
  END IF;

  v_new_ord := p_after_step + 1;

  -- 其後所有關 step_order +1(先騰位;由大到小避免 UNIQUE(offer,step_order) 撞)
  UPDATE offer_approval_steps
     SET step_order = step_order + 1
   WHERE offer_id = p_offer_id AND step_order >= v_new_ord;

  INSERT INTO offer_approval_steps (offer_id, step_order, approver_id, status, organization_id)
  VALUES (p_offer_id, v_new_ord, p_approver_id, '待審', v_ol.organization_id);

  RETURN json_build_object('ok', true, 'new_step', v_new_ord, 'total_steps', v_total + 1);
END $$;

-- web wrapper(auth.uid())
CREATE OR REPLACE FUNCTION public.add_offer_approval_signer(p_offer_id int, p_approver_id int, p_after_step int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller int; v_role text; v_priv bool;
BEGIN
  SELECT e.id, r.name INTO v_caller, v_role FROM employees e LEFT JOIN roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_caller IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  v_priv := v_role IN ('super_admin','admin') OR public.current_employee_has_permission('recruit.manage');
  RETURN public._offer_add_signer(p_offer_id, v_caller, v_priv, p_approver_id, p_after_step);
END $$;

-- LIFF wrapper(line 身分;admin bypass)
CREATE OR REPLACE FUNCTION public.liff_add_offer_signer(p_line_user_id text, p_offer_id int, p_approver_id int, p_after_step int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller int; v_role text; v_priv bool;
BEGIN
  SELECT me.id INTO v_caller FROM public._liff_resolve_employee(p_line_user_id) me LIMIT 1;
  IF v_caller IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  SELECT r.name INTO v_role FROM employees e LEFT JOIN roles r ON r.id = e.role_id WHERE e.id = v_caller;
  v_priv := v_role IN ('super_admin','admin');
  RETURN public._offer_add_signer(p_offer_id, v_caller, v_priv, p_approver_id, p_after_step);
END $$;

GRANT EXECUTE ON FUNCTION public._offer_add_signer(int,int,bool,int,int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_offer_approval_signer(int,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liff_add_offer_signer(text,int,int,int) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
