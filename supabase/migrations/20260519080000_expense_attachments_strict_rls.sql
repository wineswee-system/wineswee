-- ════════════════════════════════════════════════════════════════════════════
-- expense_request_attachments authenticated RLS 嚴版
-- ────────────────────────────────────────────────────────────────────────────
-- 之前是 authenticated USING(true) 全開 → 任何登入員工能看所有單的附件。
-- 改成「申請人 + 主鏈/核銷鏈簽核人 + 加簽人 + admin/manager」可看。
-- INSERT/UPDATE/DELETE 限「申請人本人 + admin/manager」。
--
-- anon RLS 暫不動（LIFF approvalNotify.js 還靠 anon 直查；要嚴改 RPC 之後做）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. visibility helper（看附件用：申請人 / 簽核人 / 加簽人 / admin）────
CREATE OR REPLACE FUNCTION public._expense_request_visible(p_request_id INT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp_id    INT;
  v_role_name TEXT;
  v_req       expense_requests;
BEGIN
  SELECT e.id, r.name INTO v_emp_id, v_role_name
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid() LIMIT 1;

  IF v_emp_id IS NULL THEN RETURN false; END IF;

  -- admin/manager 全看
  IF v_role_name IN ('super_admin', 'admin', 'manager') THEN
    RETURN true;
  END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RETURN false; END IF;

  -- 申請人本人
  IF v_req.employee_id = v_emp_id THEN RETURN true; END IF;

  -- 主鏈任一 step 上的簽核人
  IF v_req.approval_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs
    WHERE acs.chain_id = v_req.approval_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_req.employee_id)
  ) THEN RETURN true; END IF;

  -- 核銷鏈任一 step 上的簽核人
  IF v_req.settle_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs
    WHERE acs.chain_id = v_req.settle_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_req.employee_id)
  ) THEN RETURN true; END IF;

  -- 加簽人
  IF EXISTS (
    SELECT 1 FROM approval_extra_steps
    WHERE source_table = 'expense_requests' AND source_id = p_request_id
      AND assignee_id = v_emp_id
  ) THEN RETURN true; END IF;

  RETURN false;
END $$;

GRANT EXECUTE ON FUNCTION public._expense_request_visible(INT) TO authenticated;


-- ─── 2. editable helper（INSERT/UPDATE/DELETE 用：申請人 + admin）─────────
CREATE OR REPLACE FUNCTION public._expense_request_editable(p_request_id INT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp_id    INT;
  v_role_name TEXT;
  v_owner_id  INT;
BEGIN
  SELECT e.id, r.name INTO v_emp_id, v_role_name
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid() LIMIT 1;

  IF v_emp_id IS NULL THEN RETURN false; END IF;
  IF v_role_name IN ('super_admin', 'admin', 'manager') THEN RETURN true; END IF;

  SELECT employee_id INTO v_owner_id FROM expense_requests WHERE id = p_request_id;
  RETURN COALESCE(v_owner_id = v_emp_id, false);
END $$;

GRANT EXECUTE ON FUNCTION public._expense_request_editable(INT) TO authenticated;


-- ─── 3. 砍既有 authenticated 全開 policy，換成 4 條細粒度 ────────────────
ALTER TABLE public.expense_request_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_expense_request_attachments       ON public.expense_request_attachments;
DROP POLICY IF EXISTS expense_request_attachments_auth_all   ON public.expense_request_attachments;
DROP POLICY IF EXISTS expense_req_att_select_auth            ON public.expense_request_attachments;
DROP POLICY IF EXISTS expense_req_att_insert_auth            ON public.expense_request_attachments;
DROP POLICY IF EXISTS expense_req_att_update_auth            ON public.expense_request_attachments;
DROP POLICY IF EXISTS expense_req_att_delete_auth            ON public.expense_request_attachments;

CREATE POLICY expense_req_att_select_auth
  ON public.expense_request_attachments
  FOR SELECT TO authenticated
  USING (public._expense_request_visible(request_id));

CREATE POLICY expense_req_att_insert_auth
  ON public.expense_request_attachments
  FOR INSERT TO authenticated
  WITH CHECK (public._expense_request_editable(request_id));

CREATE POLICY expense_req_att_update_auth
  ON public.expense_request_attachments
  FOR UPDATE TO authenticated
  USING (public._expense_request_editable(request_id))
  WITH CHECK (public._expense_request_editable(request_id));

CREATE POLICY expense_req_att_delete_auth
  ON public.expense_request_attachments
  FOR DELETE TO authenticated
  USING (public._expense_request_editable(request_id));

-- GRANT 維持（policy 內細粒度控制）
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.expense_request_attachments TO authenticated;

-- anon 維持原樣（LIFF approvalNotify.js 還在直查；之後改 RPC 再嚴）
-- 若已存在 anon_expense_req_att USING(true) 不動

COMMIT;

NOTIFY pgrst, 'reload schema';
