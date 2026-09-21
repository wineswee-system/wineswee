-- 重修:經常性費用/出差 可見性「manager 全看」的洞(migration 漂移) — 2026-08-06
-- ════════════════════════════════════════════════════════════════════════════
-- 問題:_expense_visible(經常性費用) 與 _business_trip_visible(出差) 的 live 定義
--   竟是舊版「IN ('super_admin','admin','manager') → RETURN true」——manager(店長+督導混)
--   無條件看全公司所有單。20260715120000 / 20260722100000 本已把 manager blanket 拿掉
--   (改 super_admin/admin 才全看,其餘走 can_see_request 本人/店長/主管鏈),但這兩支的
--   修正沒真的套到 live(Studio 手動跑漏或被覆蓋)→ 漂移。_expense_request_visible 是新版(正常)。
-- 修:CREATE OR REPLACE 重套 20260722100000 的正確版(逐字)。純函式替換,不改 policy/資料。
-- 影響:manager/督導 不再看全公司經常性費用/出差;改為只看 本人 + 自己門市(stores.manager_id)
--   + 主管鏈下屬(can_see_request) + 簽核鏈上/加簽 的單。admin/super_admin 不變。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._expense_visible(p_id integer)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_emp_id INT; v_role_name TEXT; v_exp expenses;
BEGIN
  SELECT e.id, r.name INTO v_emp_id, v_role_name
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_exp FROM expenses WHERE id = p_id;
  IF v_exp.id IS NULL THEN RETURN false; END IF;
  IF v_role_name = 'super_admin' THEN RETURN true; END IF;
  IF v_role_name = 'admin' AND v_exp.organization_id = current_user_org_id() THEN RETURN true; END IF;
  IF public.can_see_request(v_exp.employee_id) THEN RETURN true; END IF;
  IF v_exp.approval_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs WHERE acs.chain_id = v_exp.approval_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_exp.employee_id)) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM approval_extra_steps
    WHERE source_table = 'expenses' AND source_id = p_id AND assignee_id = v_emp_id) THEN RETURN true; END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public._business_trip_visible(p_request_id integer)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_emp_id INT; v_role_name TEXT; v_req business_trips;
BEGIN
  SELECT e.id, r.name INTO v_emp_id, v_role_name
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id WHERE e.auth_user_id = auth.uid() LIMIT 1;
  IF v_emp_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_req FROM business_trips WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RETURN false; END IF;
  IF v_role_name = 'super_admin' THEN RETURN true; END IF;
  IF v_role_name = 'admin' AND v_req.organization_id = current_user_org_id() THEN RETURN true; END IF;
  IF public.can_see_request(v_req.employee_id) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM request_chain_snapshots rcs
    WHERE rcs.request_type = 'trip' AND rcs.request_id = p_request_id
      AND public._employee_matches_snapshot_step(v_emp_id, 'trip', p_request_id, rcs.step_order, v_req.employee_id)) THEN RETURN true; END IF;
  IF v_req.approval_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs WHERE acs.chain_id = v_req.approval_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_req.employee_id)) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM approval_extra_steps
    WHERE source_table = 'business_trips' AND source_id = p_request_id AND assignee_id = v_emp_id) THEN RETURN true; END IF;
  RETURN false;
END $$;

NOTIFY pgrst, 'reload schema';
