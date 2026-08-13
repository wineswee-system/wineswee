-- 還原 request_chain_snapshots 的 SELECT 可見性(轉移/RLS sweep 後 RLS 開著卻 0 policy → 前端讀 0 → 簽核軌跡壞掉)
-- 綁「看得到那張單的人才看得到它的軌跡」:跨 org 一律擋(super_admin 例外);
--   同 org 內 → admin 全看 / 申請人本人 / 這條鏈的簽核者(target_emp_id/frozen_emp_ids)/ 既有 _user_can_see_request(主管鏈)。
-- helper 為 DEFINER,直接查 request_chain_snapshots 不觸發自身 RLS(避免遞迴)。
CREATE OR REPLACE FUNCTION public._can_see_chain_snapshot(p_request_type text, p_request_id integer)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_emp int := current_employee_id();
  v_app int; v_org int; v_src text;
BEGIN
  IF v_emp IS NULL OR p_request_id IS NULL THEN RETURN false; END IF;

  -- request_type → 原單表,解出「申請人 + org」
  CASE p_request_type
    WHEN 'leave_request'    THEN v_src:='leave_requests';        SELECT employee_id, organization_id INTO v_app, v_org FROM leave_requests        WHERE id=p_request_id;
    WHEN 'overtime_request' THEN v_src:='overtime_requests';     SELECT employee_id, organization_id INTO v_app, v_org FROM overtime_requests     WHERE id=p_request_id;
    WHEN 'expense_request'  THEN v_src:='expense_requests';      SELECT employee_id, organization_id INTO v_app, v_org FROM expense_requests      WHERE id=p_request_id;
    WHEN 'expense'          THEN v_src:='expense_requests';      SELECT employee_id, organization_id INTO v_app, v_org FROM expense_requests      WHERE id=p_request_id;
    WHEN 'expense_settle'   THEN v_src:='expense_requests';      SELECT employee_id, organization_id INTO v_app, v_org FROM expense_requests      WHERE id=p_request_id;
    WHEN 'trip'             THEN v_src:='business_trips';        SELECT employee_id, organization_id INTO v_app, v_org FROM business_trips        WHERE id=p_request_id;
    WHEN 'correction'       THEN v_src:='clock_corrections';     SELECT employee_id, organization_id INTO v_app, v_org FROM clock_corrections     WHERE id=p_request_id;
    WHEN 'resignation'      THEN v_src:='resignation_requests';  SELECT employee_id, organization_id INTO v_app, v_org FROM resignation_requests  WHERE id=p_request_id;
    WHEN 'form_submission'  THEN v_src:='form_submissions';      SELECT applicant_id, organization_id INTO v_app, v_org FROM form_submissions     WHERE id=p_request_id;
    ELSE RETURN false;
  END CASE;

  -- 跨 org 一律擋(super_admin 可跨)
  IF v_org IS NULL OR v_org <> current_user_org_id() THEN
    RETURN is_super_admin();
  END IF;

  -- 同 org:admin 全看 / 申請人本人
  IF is_admin() OR v_emp = v_app THEN RETURN true; END IF;

  -- 這條鏈的簽核者(直接查快照,DEFINER 不遞迴)
  IF EXISTS (
    SELECT 1 FROM request_chain_snapshots rcs
     WHERE rcs.request_type = p_request_type AND rcs.request_id = p_request_id
       AND (rcs.target_emp_id = v_emp OR v_emp = ANY(COALESCE(rcs.frozen_emp_ids, '{}')))
  ) THEN RETURN true; END IF;

  -- 主管鏈等其餘可見性沿用既有判斷
  RETURN public._user_can_see_request(v_emp, v_src, p_request_id, v_app);
END $fn$;

REVOKE ALL ON FUNCTION public._can_see_chain_snapshot(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._can_see_chain_snapshot(text,integer) TO authenticated;

DROP POLICY IF EXISTS request_chain_snapshots_sel ON public.request_chain_snapshots;
CREATE POLICY request_chain_snapshots_sel ON public.request_chain_snapshots FOR SELECT
  USING ( ((SELECT auth.role()) = 'service_role') OR public._can_see_chain_snapshot(request_type, request_id) );

NOTIFY pgrst, 'reload schema';
