-- ════════════════════════════════════════════════════════════════════════════
-- 申請單可見性 RLS：垂直主管才看得到（解決督導/任何人看到所有人申請的洞）
-- 2026-06-17
--
-- 背景：security_health_check 抓到多個申請表 RLS 是 USING(true)（任何登入者全看/全改），
--   例如 離職/留停/銷假/調動/增補人力/請購/自訂表單。前端 isAdmin 又把 manager(店長+督導)
--   當 admin 撈全部。結果督導(其實是任何人)看得到所有人的申請。
--
-- 正確規則（用系統本來就有的 employees.supervisor_id 直屬主管樹來爬）：
--   一筆申請，下列任一成立才看得到 / 改得到：
--   ① 本人（申請人 = 我）
--   ② admin / super_admin（限同 organization）
--   ③ 我在申請人的「直屬主管鏈」上（垂直主管，遞迴往上爬 supervisor_id）
--   ④ 我是申請人所屬門市的店長（stores.manager_id = 我）— 補 supervisor_id 沒設好的店員
--
-- 實作：一支 SECURITY DEFINER 輔助函式 can_see_request(申請人emp_id)，每個表掛 policy 呼叫它。
--   用 SECURITY DEFINER 是因為 policy 不能在自己表上 self-query（會無限遞迴，本專案踩過）。
--
-- WRITE：核准動作走 web_approve_* 等 SECURITY DEFINER RPC（本來就繞過 RLS），所以直接
--   INSERT/UPDATE/DELETE policy 鎖成 can_see_request 不會擋到簽核者。
--
-- idempotent：DROP 掉每個表「所有」既有 policy 再重建（保證最終狀態一致；LIFF/anon 走
--   SECURITY DEFINER RPC 不靠這些表的直接 RLS，故不受影響）。CREATE OR REPLACE 函式。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 輔助函式：目前登入者能否看到「申請人 = p_applicant_emp_id」的單 ──────────
CREATE OR REPLACE FUNCTION public.can_see_request(p_applicant_emp_id int)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me        int := current_employee_id();
  v_my_org    int;
  v_app_org   int;
  v_app_store int;
BEGIN
  IF v_me IS NULL OR p_applicant_emp_id IS NULL THEN RETURN false; END IF;

  -- ① 本人
  IF p_applicant_emp_id = v_me THEN RETURN true; END IF;

  SELECT organization_id INTO v_my_org  FROM employees WHERE id = v_me;
  SELECT organization_id, store_id INTO v_app_org, v_app_store FROM employees WHERE id = p_applicant_emp_id;

  -- 跨 organization 一律不可見
  IF v_app_org IS DISTINCT FROM v_my_org THEN RETURN false; END IF;

  -- ② admin / super_admin（同 org）
  IF is_admin() THEN RETURN true; END IF;

  -- ④ 我是申請人門市的店長
  IF v_app_store IS NOT NULL AND EXISTS (
    SELECT 1 FROM stores s WHERE s.id = v_app_store AND s.manager_id = v_me
  ) THEN RETURN true; END IF;

  -- ③ 我在申請人的直屬主管鏈上（遞迴往上爬 supervisor_id，含深度上限防環）
  RETURN EXISTS (
    WITH RECURSIVE chain(id, supervisor_id, depth) AS (
      SELECT e.id, e.supervisor_id, 1
        FROM employees e WHERE e.id = p_applicant_emp_id
      UNION ALL
      SELECT e.id, e.supervisor_id, c.depth + 1
        FROM employees e
        JOIN chain c ON e.id = c.supervisor_id
       WHERE c.depth < 20 AND c.supervisor_id IS NOT NULL
    )
    SELECT 1 FROM chain WHERE supervisor_id = v_me
  );
END $$;

GRANT EXECUTE ON FUNCTION public.can_see_request(int) TO authenticated, anon;

-- ── 輔助函式：建單檢查（INSERT 用，放寬）──────────────────────────────────────
-- 允許「同 organization」即可送單：涵蓋本人送自己的單，以及 HR 幫他人建增補/調動單
-- （employee_id = 被建單者 ≠ 建立者）。仍擋掉跨租戶亂建。
CREATE OR REPLACE FUNCTION public.can_insert_request(p_applicant_emp_id int)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me int := current_employee_id();
BEGIN
  IF v_me IS NULL OR p_applicant_emp_id IS NULL THEN RETURN false; END IF;
  IF is_admin() THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM employees a, employees m
    WHERE a.id = p_applicant_emp_id AND m.id = v_me
      AND a.organization_id = m.organization_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.can_insert_request(int) TO authenticated, anon;

-- ── 先回填舊資料的 employee_id（off_requests 舊單/expenses 是用姓名存的，改用 id 判斷前要補）──
UPDATE public.off_requests o SET employee_id = e.id
  FROM public.employees e
 WHERE o.employee_id IS NULL AND e.name = o.employee
   AND (o.organization_id IS NULL OR e.organization_id = o.organization_id);

UPDATE public.expenses x SET employee_id = e.id
  FROM public.employees e
 WHERE x.employee_id IS NULL AND e.name = x.employee
   AND (x.organization_id IS NULL OR e.organization_id = x.organization_id);

-- ── 個人申請表：套垂直可見性（applicant 欄位逐表對應）─────────────────────────
DO $$
DECLARE
  maps text[][] := ARRAY[
    ARRAY['off_requests',                 'employee_id'],
    ARRAY['leave_requests',               'employee_id'],
    ARRAY['expense_requests',             'employee_id'],
    ARRAY['expenses',                     'employee_id'],
    ARRAY['overtime_requests',            'employee_id'],
    ARRAY['clock_corrections',            'employee_id'],
    ARRAY['resignation_requests',         'employee_id'],
    ARRAY['leave_of_absence_requests',    'employee_id'],
    ARRAY['leave_cancellation_requests',  'employee_id'],
    ARRAY['personnel_transfer_requests',  'employee_id'],
    ARRAY['headcount_requests',           'employee_id'],
    ARRAY['form_submissions',             'applicant_id']
    -- 註：purchase_requests / purchase_orders 不套垂直模型（採購部需看全部請購單才能處理、
    --     且無 organization_id 欄），另案處理。
  ];
  i int; tbl text; col text; p record; exists_tbl boolean;
BEGIN
  FOR i IN 1 .. array_length(maps, 1) LOOP
    tbl := maps[i][1]; col := maps[i][2];
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl) INTO exists_tbl;
    IF NOT exists_tbl THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    -- 砍掉所有既有 policy，保證最終狀態
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=tbl LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, tbl);
    END LOOP;

    -- SELECT/UPDATE/DELETE：垂直可見性（本人 / 主管鏈 / 店長 / admin）
    -- INSERT：放寬成同 org（本人送單 + HR 幫他人建單），仍擋跨租戶
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (can_see_request(%I))',                tbl||'_vsel', tbl, col);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (can_insert_request(%I))',        tbl||'_vins', tbl, col);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (can_see_request(%I)) WITH CHECK (can_see_request(%I))', tbl||'_vupd', tbl, col, col);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (can_see_request(%I))',                tbl||'_vdel', tbl, col);
  END LOOP;
END $$;

-- ── 設定表（非個人申請）：approval_rules / approval_extra_steps → 同 org 可讀、admin 可改 ──
DO $$
DECLARE
  cfg text[] := ARRAY['approval_rules','approval_extra_steps'];
  i int; tbl text; p record;
BEGIN
  FOR i IN 1 .. array_length(cfg,1) LOOP
    tbl := cfg[i];
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl) THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=tbl LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, tbl);
    END LOOP;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (organization_id = (SELECT organization_id FROM employees WHERE id = current_employee_id()))', tbl||'_orgsel', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (is_admin()) WITH CHECK (is_admin())', tbl||'_adminwrite', tbl);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
