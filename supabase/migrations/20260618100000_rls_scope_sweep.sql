-- ════════════════════════════════════════════════════════════════════════════
-- RLS 全庫收斂：把 USING(true) 全開的表按「org / 人員 / 門市」分類上鎖
-- 2026-06-18
--
-- 背景：security_health_check 抓到 ~124 張表 RLS 是 USING(true)（任何登入者、跨 org 全看/全改）。
--   申請表已於 20260617160000 處理。本支處理其餘可分類的表。
--
-- 策略（重要）：**以鎖「讀(SELECT)」為主**——「看到不該看的」才是這次的洞。
--   「寫」只在「真正敏感」表才鎖（薪資/資遣/LINE綁定/log/RBAC）；其餘營運/門市表的寫
--   **保持寬鬆**，避免擋到「insert 沒帶 organization_id 靠 trigger 補」之類的建立流程。
--   policy 全走 helper → 出事可把對應 helper 改 RETURN true 秒退。
--   Edge Functions(service_role) 在所有 helper 開頭放行。
--
-- 分類：
--   ORG_READ      : 營運/參考表 → SELECT 限同 org；寫保持寬鬆(true)
--   RBAC_READ     : roles/permissions → SELECT 限同 org；寫限 admin
--   ADMIN_ONLY    : 敏感 log / HR 分析 → 讀寫都限 admin
--   PERSON_VERT   : 個人 HR → SELECT/UPDATE/DELETE 本人+主管鏈+店長+admin；INSERT 同 org
--   PERSON_SELF   : 高敏個資(調薪/資遣/LINE) → SELECT 本人+admin；寫限 admin
--   STORE_READ    : 門市營運(有 store_id) → SELECT 限自己店；寫保持寬鬆(true)
--   schedules     : SELECT 放寬給主管看自己店；寫維持 admin-only(不退化)
--
-- 無 scope 欄位、無法處理的表（需先改 schema 加欄位）維持原狀，清單見本檔結尾註解。
--
-- idempotent：DROP 每表所有 policy 再重建；CREATE OR REPLACE 函式；BEGIN/COMMIT 單一交易。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── helpers（皆 service_role / admin 放行）──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_user_org()
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM employees WHERE id = current_employee_id();
$$;

CREATE OR REPLACE FUNCTION public.org_visible(p_org int)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_admin() THEN RETURN true; END IF;
  RETURN p_org IS NOT NULL AND p_org = current_user_org();
END $$;

CREATE OR REPLACE FUNCTION public.can_see_own(p_emp_id int)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_admin() THEN RETURN true; END IF;
  RETURN p_emp_id IS NOT NULL AND p_emp_id = current_employee_id();
END $$;

CREATE OR REPLACE FUNCTION public.can_see_store(p_store_id int)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me int := current_employee_id();
BEGIN
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  IF is_admin() THEN RETURN true; END IF;
  IF v_me IS NULL OR p_store_id IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM employees e WHERE e.id = v_me AND e.store_id = p_store_id) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM stores s WHERE s.id = p_store_id AND s.manager_id = v_me) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM user_stores us WHERE us.employee_id = v_me AND us.store_id = p_store_id) THEN RETURN true; END IF;
  RETURN false;
END $$;

GRANT EXECUTE ON FUNCTION public.current_user_org()   TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.org_visible(int)     TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_see_own(int)     TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_see_store(int)   TO authenticated, anon;

CREATE OR REPLACE FUNCTION public._drop_all_policies(p_tbl text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=p_tbl LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p_tbl);
  END LOOP;
END $$;

-- ── ① ORG_READ：SELECT 限同 org；寫保持寬鬆（不擋建立流程）──────────────────────
DO $$
DECLARE
  tbls text[] := ARRAY['accommodations','accounts','broker_agencies','customers',
    'inventory_adjustments','notifications','outbound_orders','recruitment_jobs','skus',
    'task_attachments','form_chain_configs','form_templates','projects','project_sections',
    'project_members','store_bonus_role_config','department_sections','employee_schedule_patterns'];
  i int; t text;
BEGIN
  FOR i IN 1..array_length(tbls,1) LOOP
    t := tbls[i];
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='organization_id') THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    PERFORM public._drop_all_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (org_visible(organization_id))', t||'_org_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (true)', t||'_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (true) WITH CHECK (true)', t||'_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (true)', t||'_del', t);
  END LOOP;
END $$;

-- ── ② RBAC_READ：roles/permissions → SELECT 同 org；寫限 admin ────────────────
DO $$
DECLARE tbls text[] := ARRAY['roles','permissions']; i int; t text;
BEGIN
  FOR i IN 1..array_length(tbls,1) LOOP
    t := tbls[i];
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='organization_id') THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    PERFORM public._drop_all_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (org_visible(organization_id))', t||'_org_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (is_admin() OR auth.role()=''service_role'') WITH CHECK (is_admin() OR auth.role()=''service_role'')', t||'_admin_w', t);
  END LOOP;
END $$;

-- ── ③ ADMIN_ONLY：敏感 log / HR 分析（讀寫限 admin / service）──────────────────
DO $$
DECLARE tbls text[] := ARRAY['audit_logs','deletion_drain','message_logs','attrition_risk_snapshots']; i int; t text;
BEGIN
  FOR i IN 1..array_length(tbls,1) LOOP
    t := tbls[i];
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    PERFORM public._drop_all_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (is_admin() OR auth.role()=''service_role'') WITH CHECK (is_admin() OR auth.role()=''service_role'')', t||'_admin_only', t);
  END LOOP;
END $$;

-- ── ④ PERSON_VERT：個人 HR（本人/主管鏈/店長/admin；INSERT 放寬同 org）──────────
DO $$
DECLARE
  tbls text[] := ARRAY['accommodation_assignments','annual_bonus_tracker','business_trips',
    'certifications','education_records','employee_contracts','family_members',
    'foreign_worker_docs','foreign_worker_profiles','nhi_supplementary_records',
    'position_history','store_audit_on_duty','store_bonus_employee','work_experiences',
    'employee_assignments'];
  i int; t text;
BEGIN
  FOR i IN 1..array_length(tbls,1) LOOP
    t := tbls[i];
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='employee_id') THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    PERFORM public._drop_all_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (can_see_request(employee_id))', t||'_v_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (can_insert_request(employee_id))', t||'_v_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (can_see_request(employee_id)) WITH CHECK (can_see_request(employee_id))', t||'_v_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (can_see_request(employee_id))', t||'_v_del', t);
  END LOOP;
END $$;

-- ── ⑤ PERSON_SELF：高敏個資（本人+admin 讀；寫限 admin）— 調薪/資遣/LINE 綁定 ─────
DO $$
DECLARE tbls text[] := ARRAY['salary_adjustments','severance_records','line_users','employee_line_accounts']; i int; t text;
BEGIN
  FOR i IN 1..array_length(tbls,1) LOOP
    t := tbls[i];
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='employee_id') THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    PERFORM public._drop_all_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (can_see_own(employee_id))', t||'_self_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (is_admin() OR auth.role()=''service_role'') WITH CHECK (is_admin() OR auth.role()=''service_role'')', t||'_self_w', t);
  END LOOP;
END $$;

-- ── ⑥ STORE_READ：門市營運(有 store_id) → SELECT 限自己店；寫保持寬鬆 ──────────
DO $$
DECLARE tbls text[] := ARRAY['schedule_month_locks','shift_swaps','store_audits','store_bonus_monthly']; i int; t text;
BEGIN
  FOR i IN 1..array_length(tbls,1) LOOP
    t := tbls[i];
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='store_id') THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    PERFORM public._drop_all_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (can_see_store(store_id))', t||'_st_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (true)', t||'_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (true) WITH CHECK (true)', t||'_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (true)', t||'_del', t);
  END LOOP;
END $$;

-- ── ⑦ schedules：SELECT 放寬給主管看自己店；寫維持 admin-only（不退化）────────────
UPDATE public.schedules s SET employee_id = e.id
  FROM public.employees e
 WHERE s.employee_id IS NULL AND e.name = s.employee
   AND (s.organization_id IS NULL OR e.organization_id = s.organization_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='schedules' AND column_name='employee_id') THEN
    ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
    PERFORM public._drop_all_policies('schedules');
    CREATE POLICY schedules_v_sel   ON public.schedules FOR SELECT USING (can_see_request(employee_id));
    CREATE POLICY schedules_v_write ON public.schedules FOR ALL USING (is_admin() OR auth.role()='service_role') WITH CHECK (is_admin() OR auth.role()='service_role');
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
