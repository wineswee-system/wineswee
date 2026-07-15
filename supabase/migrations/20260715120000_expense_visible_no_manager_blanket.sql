-- 申請可見性:拿掉「manager 全看」的洞(費用申請/出差/經常性費用) — 2026-07-15
-- 問題:_expense_request_visible / _business_trip_visible / _expense_visible 都把 manager 跟 admin 綁一起「全看」
--   → manager/督導 角色看得到全公司所有單。但 manager=店長+督導混,督導也不該看全部。
-- 修:只有 admin/super_admin 全看;其餘一律走 can_see_request(本人/店長 stores.manager_id/主管鏈下屬)
--   + 保留簽核人(主鏈/核銷鏈/snapshot/加簽)。督導只看得到自己主管鏈下的人的單。

-- ① 費用申請(非經常性)
CREATE OR REPLACE FUNCTION public._expense_request_visible(p_request_id integer)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_emp_id INT; v_role_name TEXT; v_req expense_requests;
BEGIN
  SELECT e.id, r.name INTO v_emp_id, v_role_name
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN RETURN false; END IF;
  IF v_role_name IN ('super_admin', 'admin') THEN RETURN true; END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RETURN false; END IF;

  IF public.can_see_request(v_req.employee_id) THEN RETURN true; END IF;  -- 本人/店長/主管鏈

  IF v_req.approval_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs WHERE acs.chain_id = v_req.approval_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_req.employee_id)) THEN RETURN true; END IF;
  IF v_req.settle_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs WHERE acs.chain_id = v_req.settle_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_req.employee_id)) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM approval_extra_steps
    WHERE source_table = 'expense_requests' AND source_id = p_request_id AND assignee_id = v_emp_id) THEN RETURN true; END IF;
  RETURN false;
END $function$;

-- ② 出差
CREATE OR REPLACE FUNCTION public._business_trip_visible(p_request_id integer)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_emp_id INT; v_role_name TEXT; v_req business_trips;
BEGIN
  SELECT e.id, r.name INTO v_emp_id, v_role_name
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN RETURN false; END IF;
  IF v_role_name IN ('super_admin', 'admin') THEN RETURN true; END IF;

  SELECT * INTO v_req FROM business_trips WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RETURN false; END IF;

  IF public.can_see_request(v_req.employee_id) THEN RETURN true; END IF;  -- 本人/店長/主管鏈

  IF EXISTS (SELECT 1 FROM request_chain_snapshots rcs
    WHERE rcs.request_type = 'trip' AND rcs.request_id = p_request_id
      AND public._employee_matches_snapshot_step(v_emp_id, 'trip', p_request_id, rcs.step_order, v_req.employee_id)) THEN RETURN true; END IF;
  IF v_req.approval_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs WHERE acs.chain_id = v_req.approval_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_req.employee_id)) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM approval_extra_steps
    WHERE source_table = 'business_trips' AND source_id = p_request_id AND assignee_id = v_emp_id) THEN RETURN true; END IF;
  RETURN false;
END $function$;

-- ③ 經常性費用
CREATE OR REPLACE FUNCTION public._expense_visible(p_id integer)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_emp_id INT; v_role_name TEXT; v_exp expenses;
BEGIN
  SELECT e.id, r.name INTO v_emp_id, v_role_name
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN RETURN false; END IF;
  IF v_role_name IN ('super_admin', 'admin') THEN RETURN true; END IF;

  SELECT * INTO v_exp FROM expenses WHERE id = p_id;
  IF v_exp.id IS NULL THEN RETURN false; END IF;

  IF public.can_see_request(v_exp.employee_id) THEN RETURN true; END IF;  -- 本人/店長/主管鏈

  IF v_exp.approval_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs WHERE acs.chain_id = v_exp.approval_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_exp.employee_id)) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM approval_extra_steps
    WHERE source_table = 'expenses' AND source_id = p_id AND assignee_id = v_emp_id) THEN RETURN true; END IF;
  RETURN false;
END $function$;

NOTIFY pgrst, 'reload schema';
