-- ════════════════════════════════════════════════════════════════════════════
-- 簽核表 SELECT RLS：申請人 + chain 簽核者 + 加簽人 + admin 才看得到
--
-- 問題：
-- 1. expense_requests / business_trips / resignation / loa / transfer /
--    headcount / form_submissions 7 表都是 FOR SELECT USING (true) 全公司可見
-- 2. leave / overtime / clock_corrections 3 表雖然有 admin OR self 限制，
--    但非 admin 簽核者看不到自己簽過的單詳細（ApprovalCenter 已簽核頁點不開）
--
-- 修法：共用 helper _user_can_see_request() 包三種角色判斷：
--   - chain 簽核者：透過 request_chain_snapshots，含動態 target (applicant_*)
--   - 加簽人：透過 approval_extra_steps
--   - 配合既有 admin / 申請人本人 OR 條件，10 個 form 表同套邏輯
--
-- 範圍：只動 SELECT policy；INSERT/UPDATE/DELETE 維持原狀避免風險
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 共用 helper ───
CREATE OR REPLACE FUNCTION public._user_can_see_request(
  p_emp_id           INT,
  p_source_table     TEXT,
  p_request_id       INT,
  p_applicant_emp_id INT
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_request_type TEXT;
BEGIN
  IF p_emp_id IS NULL OR p_request_id IS NULL THEN RETURN FALSE; END IF;

  -- source_table → snapshot 用的 request_type
  v_request_type := CASE p_source_table
    WHEN 'leave_requests'              THEN 'leave_request'
    WHEN 'overtime_requests'           THEN 'overtime_request'
    WHEN 'expense_requests'            THEN 'expense_request'
    WHEN 'business_trips'              THEN 'trip'
    WHEN 'clock_corrections'           THEN 'correction'
    WHEN 'resignation_requests'        THEN 'resignation'
    WHEN 'leave_of_absence_requests'   THEN 'loa'
    WHEN 'personnel_transfer_requests' THEN 'transfer'
    WHEN 'headcount_requests'          THEN 'headcount'
    WHEN 'form_submissions'            THEN 'form_submission'
  END;

  -- chain 簽核者（含動態 target 由 _employee_matches_snapshot_step 解析）
  IF v_request_type IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
        FROM public.request_chain_snapshots rcs
       WHERE rcs.request_type = v_request_type
         AND rcs.request_id   = p_request_id
         AND (
           rcs.target_emp_id = p_emp_id
           OR public._employee_matches_snapshot_step(
                p_emp_id, rcs.request_type, rcs.request_id, rcs.step_order,
                p_applicant_emp_id
              )
         )
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- 加簽人
  IF EXISTS (
    SELECT 1
      FROM public.approval_extra_steps aes
     WHERE aes.source_table = p_source_table
       AND aes.source_id    = p_request_id
       AND aes.assignee_id  = p_emp_id
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END $$;

GRANT EXECUTE ON FUNCTION public._user_can_see_request(INT, TEXT, INT, INT)
  TO authenticated, anon;

COMMENT ON FUNCTION public._user_can_see_request(INT, TEXT, INT, INT) IS
  '判斷某員工能否看到指定 form row：含 chain 簽核者（用 snapshot + 動態 target 解析）+ 加簽人。供 RLS policy 用。';


-- ════════════════════════════════════════════════════════════════════════════
-- 2. 10 個 form 表的 SELECT policy
-- ════════════════════════════════════════════════════════════════════════════

-- ─── leave_requests ───
DROP POLICY IF EXISTS leave_select ON public.leave_requests;
CREATE POLICY leave_select ON public.leave_requests
FOR SELECT USING (
  is_admin()
  OR employee = current_employee_name()
  OR public._user_can_see_request(current_employee_id(), 'leave_requests', id, employee_id)
);

-- ─── overtime_requests ───
DROP POLICY IF EXISTS overtime_select ON public.overtime_requests;
CREATE POLICY overtime_select ON public.overtime_requests
FOR SELECT USING (
  is_admin()
  OR employee = current_employee_name()
  OR public._user_can_see_request(current_employee_id(), 'overtime_requests', id, employee_id)
);

-- ─── clock_corrections ───
DROP POLICY IF EXISTS clock_corrections_select ON public.clock_corrections;
CREATE POLICY clock_corrections_select ON public.clock_corrections
FOR SELECT USING (
  is_admin()
  OR employee = current_employee_name()
  OR public._user_can_see_request(current_employee_id(), 'clock_corrections', id, employee_id)
);

-- ─── expense_requests（原本 FOR ALL TO authenticated USING true，先砍再分 SELECT/其他）───
DROP POLICY IF EXISTS auth_expense_requests ON public.expense_requests;
DROP POLICY IF EXISTS expense_requests_select ON public.expense_requests;
CREATE POLICY expense_requests_select ON public.expense_requests
FOR SELECT TO authenticated USING (
  is_admin()
  OR employee = current_employee_name()
  OR public._user_can_see_request(current_employee_id(), 'expense_requests', id, employee_id)
);
-- 維持寫入維度（與舊行為一致）
DROP POLICY IF EXISTS expense_requests_write ON public.expense_requests;
CREATE POLICY expense_requests_write ON public.expense_requests
FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS expense_requests_update ON public.expense_requests;
CREATE POLICY expense_requests_update ON public.expense_requests
FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS expense_requests_delete ON public.expense_requests;
CREATE POLICY expense_requests_delete ON public.expense_requests
FOR DELETE TO authenticated USING (true);

-- ─── business_trips ───
DROP POLICY IF EXISTS "business_trips_read" ON public.business_trips;
DROP POLICY IF EXISTS business_trips_select ON public.business_trips;
CREATE POLICY business_trips_select ON public.business_trips
FOR SELECT USING (
  is_admin()
  OR employee = current_employee_name()
  OR public._user_can_see_request(current_employee_id(), 'business_trips', id, employee_id)
);
DROP POLICY IF EXISTS "business_trips_write" ON public.business_trips;
CREATE POLICY business_trips_write ON public.business_trips
FOR ALL USING (true) WITH CHECK (true);

-- ─── resignation_requests（沒 employee text，純 employee_id）───
DROP POLICY IF EXISTS "resignation_requests_read" ON public.resignation_requests;
DROP POLICY IF EXISTS resignation_requests_select ON public.resignation_requests;
CREATE POLICY resignation_requests_select ON public.resignation_requests
FOR SELECT USING (
  is_admin()
  OR employee_id = current_employee_id()
  OR public._user_can_see_request(current_employee_id(), 'resignation_requests', id, employee_id)
);
DROP POLICY IF EXISTS "resignation_requests_write" ON public.resignation_requests;
CREATE POLICY resignation_requests_write ON public.resignation_requests
FOR ALL USING (true) WITH CHECK (true);

-- ─── leave_of_absence_requests ───
DROP POLICY IF EXISTS "leave_of_absence_requests_read" ON public.leave_of_absence_requests;
DROP POLICY IF EXISTS loa_select ON public.leave_of_absence_requests;
CREATE POLICY loa_select ON public.leave_of_absence_requests
FOR SELECT USING (
  is_admin()
  OR employee_id = current_employee_id()
  OR public._user_can_see_request(current_employee_id(), 'leave_of_absence_requests', id, employee_id)
);
DROP POLICY IF EXISTS "leave_of_absence_requests_write" ON public.leave_of_absence_requests;
CREATE POLICY loa_write ON public.leave_of_absence_requests
FOR ALL USING (true) WITH CHECK (true);

-- ─── personnel_transfer_requests ───
DROP POLICY IF EXISTS "personnel_transfer_requests_read" ON public.personnel_transfer_requests;
DROP POLICY IF EXISTS personnel_transfer_select ON public.personnel_transfer_requests;
CREATE POLICY personnel_transfer_select ON public.personnel_transfer_requests
FOR SELECT USING (
  is_admin()
  OR employee_id = current_employee_id()
  OR public._user_can_see_request(current_employee_id(), 'personnel_transfer_requests', id, employee_id)
);
DROP POLICY IF EXISTS "personnel_transfer_requests_write" ON public.personnel_transfer_requests;
CREATE POLICY personnel_transfer_write ON public.personnel_transfer_requests
FOR ALL USING (true) WITH CHECK (true);

-- ─── headcount_requests ───
DROP POLICY IF EXISTS "headcount_requests_read" ON public.headcount_requests;
DROP POLICY IF EXISTS headcount_select ON public.headcount_requests;
CREATE POLICY headcount_select ON public.headcount_requests
FOR SELECT USING (
  is_admin()
  OR employee_id = current_employee_id()
  OR public._user_can_see_request(current_employee_id(), 'headcount_requests', id, employee_id)
);
DROP POLICY IF EXISTS "headcount_requests_write" ON public.headcount_requests;
CREATE POLICY headcount_write ON public.headcount_requests
FOR ALL USING (true) WITH CHECK (true);

-- ─── form_submissions（applicant 欄是 applicant_id）───
DROP POLICY IF EXISTS "form_submissions_read" ON public.form_submissions;
DROP POLICY IF EXISTS form_submissions_select ON public.form_submissions;
CREATE POLICY form_submissions_select ON public.form_submissions
FOR SELECT USING (
  is_admin()
  OR applicant_id = current_employee_id()
  OR public._user_can_see_request(current_employee_id(), 'form_submissions', id, applicant_id)
);
DROP POLICY IF EXISTS "form_submissions_write" ON public.form_submissions;
CREATE POLICY form_submissions_write ON public.form_submissions
FOR ALL USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── 健檢：列出各表現在的 SELECT policy 數量 ───
DO $$
DECLARE
  v_rec RECORD;
BEGIN
  RAISE NOTICE '── 各 form 表 SELECT policy 狀態 ──';
  FOR v_rec IN
    SELECT tablename, COUNT(*) AS sel_count
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN (
         'leave_requests','overtime_requests','clock_corrections','expense_requests',
         'business_trips','resignation_requests','leave_of_absence_requests',
         'personnel_transfer_requests','headcount_requests','form_submissions'
       )
       AND cmd = 'SELECT'
     GROUP BY tablename
     ORDER BY tablename
  LOOP
    RAISE NOTICE '  %: % 條 SELECT policy', v_rec.tablename, v_rec.sel_count;
  END LOOP;
END $$;
