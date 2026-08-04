-- 資安稽核唯讀函式 _security_audit() — 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 純唯讀:掃 live 的 RLS/policy/grant/DEFINER,回 JSON。給 AI 分析用,不改任何資料。
-- 跑完:SELECT public._security_audit();  → 把結果貼回。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._security_audit()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $function$
SELECT jsonb_build_object(
  -- 1) RLS 沒開的資料表(public schema)— 開了洞最直接
  'rls_disabled', (
    SELECT COALESCE(jsonb_agg(c.relname ORDER BY c.relname), '[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
  ),
  -- 2) anon(公網)可「寫入」的 policy — 最危險(INSERT/UPDATE/DELETE/ALL)
  'anon_write_policies', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('table',tablename,'policy',policyname,'cmd',cmd,'using',qual,'check',with_check) ORDER BY tablename), '[]'::jsonb)
    FROM pg_policies
    WHERE schemaname='public' AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
      AND (roles && ARRAY['anon','public']::name[])
  ),
  -- 3) 任何角色的「寫入」policy 用 USING(true) 或 WITH CHECK(true) — 無範圍限制
  'permissive_write_policies', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('table',tablename,'policy',policyname,'cmd',cmd,'roles',roles,'using',qual,'check',with_check) ORDER BY tablename), '[]'::jsonb)
    FROM pg_policies
    WHERE schemaname='public' AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
      AND (COALESCE(qual,'')='true' OR COALESCE(with_check,'')='true')
  ),
  -- 4) anon 有 INSERT/UPDATE/DELETE 的資料表 grant(RLS 關掉時=直接開洞)
  'anon_write_grants', (
    SELECT COALESCE(jsonb_agg(DISTINCT (table_name||':'||privilege_type)), '[]'::jsonb)
    FROM information_schema.role_table_grants
    WHERE grantee='anon' AND table_schema='public' AND privilege_type IN ('INSERT','UPDATE','DELETE')
  ),
  -- 5) SECURITY DEFINER 函式且 anon 可執行 — 需逐支確認有無 org/auth/role 守門
  'definer_funcs_anon_executable', (
    SELECT COALESCE(jsonb_agg(p.proname ORDER BY p.proname), '[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  -- 6) anon 可「讀」的 policy 表(SELECT)— 檢查有無敏感表(薪資/員工/帳號)開給 anon
  'anon_read_policies_tables', (
    SELECT COALESCE(jsonb_agg(DISTINCT tablename ORDER BY tablename), '[]'::jsonb)
    FROM pg_policies
    WHERE schemaname='public' AND cmd IN ('SELECT','ALL') AND (roles && ARRAY['anon','public']::name[])
  ),
  'summary', (
    SELECT jsonb_build_object(
      'rls_disabled_count', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity),
      'total_policies', (SELECT count(*) FROM pg_policies WHERE schemaname='public'),
      'definer_funcs_total', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef)
    )
  )
);
$function$;

REVOKE ALL ON FUNCTION public._security_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._security_audit() TO service_role;
