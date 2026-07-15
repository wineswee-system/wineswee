-- 錄取簽呈核准/駁回改走 SECURITY DEFINER RPC(照鐵律:簽核走 DB 不准前端推)— 2026-07-15
-- 原本前端分兩刀(updateOfferLetter + updateCandidate)→ 不原子、DB 沒把關誰能簽。
-- 改成一支 RPC:DB 內驗「caller 是指定簽核人 / admin / 有 recruit.manage」,
--   一個 transaction 內同時更新 offer + candidate(原子)。純加法。

CREATE OR REPLACE FUNCTION public.approve_offer_letter(
  p_id integer, p_action text, p_reason text DEFAULT NULL
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id int;
  v_role      text;
  v_ol        offer_letters;
BEGIN
  SELECT e.id, r.name INTO v_caller_id, v_role
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_caller_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT * INTO v_ol FROM offer_letters WHERE id = p_id;
  IF v_ol.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  -- 把關:只有指定簽核人 / admin / super_admin / 有 recruit.manage 的人能簽
  IF NOT (
    v_ol.approver_id = v_caller_id
    OR v_role IN ('super_admin', 'admin')
    OR public.current_employee_has_permission('recruit.manage')
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  IF v_ol.status <> '待審' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED', 'status', v_ol.status);
  END IF;

  IF p_action = 'approve' THEN
    UPDATE offer_letters SET status = '已核准', approved_at = now() WHERE id = p_id;
    UPDATE candidates
       SET stage = '已錄取', hire_status = '已核准',
           stage_history = COALESCE(stage_history::jsonb, '[]'::jsonb)
                           || jsonb_build_object('stage', '已錄取', 'changed_at', now())
     WHERE id = v_ol.candidate_id;
    RETURN json_build_object('ok', true, 'status', '已核准');

  ELSIF p_action = 'reject' THEN
    UPDATE offer_letters SET status = '已駁回', reject_reason = p_reason WHERE id = p_id;
    UPDATE candidates SET hire_status = '已駁回' WHERE id = v_ol.candidate_id;
    RETURN json_build_object('ok', true, 'status', '已駁回');

  ELSE
    RETURN json_build_object('ok', false, 'error', 'BAD_ACTION');
  END IF;
END $function$;

GRANT EXECUTE ON FUNCTION public.approve_offer_letter(integer, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
