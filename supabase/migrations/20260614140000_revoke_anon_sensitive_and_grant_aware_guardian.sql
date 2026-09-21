-- ════════════════════════════════════════════════════════════════════════════
-- 資安 Wave 1：撤掉 anon 對「敏感 HR/薪資/個資」表的直接 grant + 守門員改成「看得到 grant」
--
-- 背景：security_health_check() 第一版只看 policy，不看 grant。但 anon 要真的讀到
--   資料，需要「permissive policy」+「table grant」兩個都成立。只有 policy、沒 grant
--   → anon 其實讀不到。所以舊版會把一堆「其實安全」的 org-scoped policy 也報成紅色，
--   真正的洞被淹沒。
--
-- 真正的內網外洩 = (public/anon role) + USING(true) + anon 真的有 grant。
-- 這類表（severance / salary_adjustments / foreign_worker_docs / nhi / family_members
--   / employee_contracts …）拿 anon key 就能從公網直接撈，是致命級。
--
-- 本檔做兩件事：
--   A. REVOKE anon 對這些敏感表的 grant（不動任何 policy → 主系統 authenticated 不受影響）
--      已驗證 LIFF src/ 對這些表 0 處 .from() 直查，全走 SECURITY DEFINER RPC → 不會壞。
--   B. 把 security_health_check() 升級成「grant-aware」：anon 檢查改看 has_table_privilege，
--      只報「真的讀得到」的；USING(true) 拆成 anon致命 / 登入者跨租戶 兩級。
--
-- 不在本檔處理（LIFF 有直查，要先改 RPC 才能 REVOKE）：
--   expense_request_attachments / approval_extra_steps
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── A. 撤掉 anon 對敏感表的直接 grant ──────────────────────────────────────
--   清單僅含「LIFF 不直查、主系統走 authenticated」的表 → 零破壞。
--   REVOKE 不存在的 grant 不會報錯；用 to_regclass 跳過不存在的表 → idempotent。
DO $revoke$
DECLARE
  t TEXT;
  sensitive_tables TEXT[] := ARRAY[
    -- 薪資 / 資遣 / 獎金 / 健保（最敏感）
    'severance_records', 'salary_adjustments', 'annual_bonus_tracker',
    'nhi_supplementary_records', 'employee_contracts', 'legal_deductions',
    -- 個資（家屬 / 學經歷 / 證照）
    'family_members', 'education_records', 'work_experiences', 'certifications',
    'position_history',
    -- 外籍移工（含證件 / 宿舍 / 仲介）
    'foreign_worker_profiles', 'foreign_worker_docs', 'accommodations',
    'accommodation_assignments', 'broker_agencies',
    -- 人事流程單據
    'business_trips', 'personnel_transfer_requests', 'headcount_requests',
    'headcount_request_templates', 'resignation_requests',
    'leave_of_absence_requests', 'leave_cancellation_requests',
    -- 表單 / SOP / 簽核設定
    'form_submissions', 'form_templates', 'form_chain_configs',
    'sop_template_versions',
    -- 招募 / 面試 / offer
    'recruitment_jobs', 'candidates', 'interviews', 'offer_letters',
    'offer_letter_templates', 'interview_evaluation_templates',
    -- LMS 教育訓練
    'lms_courses', 'lms_enrollments', 'lms_sections', 'lms_lessons',
    'lms_progress', 'lms_certificates', 'training_courses', 'training_enrollments',
    -- 專案（孤兒 anon policy）
    'project_custom_field_values', 'project_comments',
    'project_custom_field_defs', 'project_templates',
    -- 門市稽核 / 門市獎金 / 離職風險
    'store_audits', 'store_audit_items', 'store_audit_on_duty',
    'store_bonus_monthly', 'store_bonus_employee', 'store_bonus_role_config',
    'attrition_risk_snapshots',
    -- 排班補位 / 報價明細
    'shift_cover_requests', 'quotation_lines'
  ];
BEGIN
  FOREACH t IN ARRAY sensitive_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END $revoke$;


-- ─── B. 守門員升級：grant-aware ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.security_health_check()
RETURNS TABLE(severity TEXT, category TEXT, object TEXT, detail TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
  WITH org_tables AS (
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id'
  ),
  -- 每條 policy 對應的 cmd，anon 是否「真的」有對應的 table 權限
  pol AS (
    SELECT
      p.tablename, p.policyname, p.cmd, p.qual, p.roles,
      ('anon' = ANY(p.roles) OR 'public' = ANY(p.roles)) AS targets_anon,
      ('authenticated' = ANY(p.roles) OR 'public' = ANY(p.roles)) AS targets_auth,
      CASE p.cmd
        WHEN 'SELECT' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'SELECT')
        WHEN 'INSERT' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'INSERT')
        WHEN 'UPDATE' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'UPDATE')
        WHEN 'DELETE' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'DELETE')
        WHEN 'ALL'    THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'SELECT')
                        OR has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'INSERT')
                        OR has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'UPDATE')
                        OR has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'DELETE')
        ELSE false
      END AS anon_has_grant
    FROM pg_policies p
    WHERE p.schemaname = 'public'
  )

  -- 1. 🔴 致命：anon 真的讀/寫得到（policy 給 anon/public + anon 有 grant）
  SELECT '🔴 致命(anon公網可達)'::text, 'anon直達'::text,
         (pol.tablename || ' / ' || pol.policyname)::text,
         ('cmd=' || pol.cmd || '  qual=' || COALESCE(left(pol.qual, 40), 'NULL'))::text
  FROM pol
  WHERE pol.targets_anon AND pol.anon_has_grant

  UNION ALL
  -- 2. 🟠 高：登入者跨租戶（USING(true) + 只有 authenticated 拿得到、anon 拿不到）
  SELECT '🟠 高(登入者跨租戶)', '完全開放USING(true)',
         (pol.tablename || ' / ' || pol.policyname),
         ('cmd=' || pol.cmd || ' — 任何登入者(不分org)全' ||
          CASE pol.cmd WHEN 'SELECT' THEN '看' ELSE '改' END)
  FROM pol
  WHERE pol.qual = 'true' AND pol.cmd IN ('SELECT', 'ALL')
    AND pol.targets_auth
    AND NOT (pol.targets_anon AND pol.anon_has_grant)   -- 已被第 1 類涵蓋者不重複報

  UNION ALL
  -- 3. 🔴 致命：有 org_id 但沒啟用 RLS，且 anon/authenticated 拿得到 grant（裸表）
  SELECT '🔴 致命(裸表無RLS)',
         CASE WHEN has_table_privilege('anon', ('public.'||c.relname)::regclass, 'SELECT')
              THEN '裸表-anon可讀' ELSE '裸表-登入者可讀' END,
         ('public.' || c.relname),
         '有 organization_id 但 RLS 未啟用 → 無任何過濾'
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    AND c.relname IN (SELECT table_name FROM org_tables)
    AND ( has_table_privilege('anon', c.oid, 'SELECT')
       OR has_table_privilege('authenticated', c.oid, 'SELECT') )

  UNION ALL
  -- 4. 🟡 中：SECURITY DEFINER + anon 可執行 + 收 p_org_id（確認內部有 org guard）
  SELECT '🟡 中(DEFINER繞RLS)', 'DEFINER+anon+org參數',
         (n.nspname || '.' || pr.proname),
         'SECURITY DEFINER 又給 anon、又收 p_org_id — 確認內部有 org guard'
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.prosecdef
    AND pr.proargnames @> ARRAY['p_org_id']
    AND has_function_privilege('anon', pr.oid, 'EXECUTE')
$$;

REVOKE ALL ON FUNCTION public.security_health_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_health_check() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
