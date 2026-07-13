-- 出差申請 approver 可見性 — 2026-07-13
-- 背景:出差頁 SELECT 目前靠 can_see_request(employee_id)(申請人本人 + 直屬上級鏈 + admin)。
--   簽核鏈上「非直屬上級」的簽核人(例:人資主管 張啟達 簽 侯承寯 的單)在獨立的「公出差旅」頁
--   RLS 看不到那張 row(儀表板簽核中心/LINE/LIFF 走 SECURITY DEFINER RPC 不受影響,但獨立頁受限)。
-- 做法:比照費用單 _expense_request_visible,加一支 _business_trip_visible + 一條 additive 的 SELECT policy。
--   純加法(permissive policy 會跟現有 OR),不動 can_see_request、不影響既有可見範圍。idempotent。
-- 可見性判定用 SECURITY DEFINER 內部讀表(不套 RLS)→ 不會 self-recursion(同費用單已驗證的手法)。

CREATE OR REPLACE FUNCTION public._business_trip_visible(p_request_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp_id    INT;
  v_role_name TEXT;
  v_req       business_trips;
BEGIN
  SELECT e.id, r.name INTO v_emp_id, v_role_name
    FROM employees e LEFT JOIN roles r ON r.id = e.role_id
   WHERE e.auth_user_id = auth.uid() LIMIT 1;

  IF v_emp_id IS NULL THEN RETURN false; END IF;

  -- admin/manager 全看(與現有政策一致)
  IF v_role_name IN ('super_admin', 'admin', 'manager') THEN
    RETURN true;
  END IF;

  SELECT * INTO v_req FROM business_trips WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RETURN false; END IF;

  -- 申請人本人
  IF v_req.employee_id = v_emp_id THEN RETURN true; END IF;

  -- in-flight 單據以 snapshot 為準:snapshot 任一 step 上的簽核人
  IF EXISTS (
    SELECT 1 FROM request_chain_snapshots rcs
    WHERE rcs.request_type = 'trip' AND rcs.request_id = p_request_id
      AND public._employee_matches_snapshot_step(v_emp_id, 'trip', p_request_id, rcs.step_order, v_req.employee_id)
  ) THEN RETURN true; END IF;

  -- 無 snapshot 時退回 live chain:主鏈任一 step 上的簽核人
  IF v_req.approval_chain_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM approval_chain_steps acs
    WHERE acs.chain_id = v_req.approval_chain_id
      AND public._employee_matches_chain_step(v_emp_id, acs.id, v_req.employee_id)
  ) THEN RETURN true; END IF;

  -- 加簽人
  IF EXISTS (
    SELECT 1 FROM approval_extra_steps
    WHERE source_table = 'business_trips' AND source_id = p_request_id
      AND assignee_id = v_emp_id
  ) THEN RETURN true; END IF;

  RETURN false;
END $function$;

-- additive SELECT policy(與 can_see_request 政策 OR;純擴大簽核人可見,不縮小任何範圍)
DROP POLICY IF EXISTS business_trips_approver_sel ON public.business_trips;
CREATE POLICY business_trips_approver_sel ON public.business_trips
  FOR SELECT USING (public._business_trip_visible(id));

NOTIFY pgrst, 'reload schema';
