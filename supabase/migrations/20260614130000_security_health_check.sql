-- ════════════════════════════════════════════════════════════════════════════
-- 資安守門員 — security_health_check()
--
-- 一次列出當下所有「租戶隔離 / RLS」違規。每次改完 DB（你或老闆）跑一下：
--     SELECT * FROM public.security_health_check() ORDER BY severity, category;
-- 洞長回來、新表沒鎖、新 RPC 漏驗證 → 立刻現形。治本（防 drift），不是治標。
--
-- 檢查項目：
--   1. anon 可存取的 policy（套用到 anon/public role）
--   2. USING(true) 完全開放的 SELECT/ALL policy
--   3. 有 organization_id 但沒啟用 RLS 的裸表
--   4. SECURITY DEFINER + grant anon + 收 p_org_id 的函式（跨租戶高風險）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.security_health_check()
RETURNS TABLE(severity TEXT, category TEXT, object TEXT, detail TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
  WITH org_tables AS (
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id'
  )

  -- 1. anon / public 可存取的 policy
  SELECT '🔴 高'::text, 'anon可存取'::text,
         (p.tablename || ' / ' || p.policyname)::text,
         ('roles=' || p.roles::text || '  cmd=' || p.cmd)::text
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND ('anon' = ANY(p.roles) OR 'public' = ANY(p.roles))

  UNION ALL
  -- 2. USING(true) 完全開放（任何符合 role 者全看/全改）
  SELECT '🔴 高', '完全開放USING(true)',
         (p.tablename || ' / ' || p.policyname),
         ('cmd=' || p.cmd)
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.qual = 'true'
    AND p.cmd IN ('SELECT', 'ALL')

  UNION ALL
  -- 3. 有 org_id 但沒啟用 RLS（裸表）
  SELECT '🔴 高', '裸表(無RLS)',
         ('public.' || c.relname),
         '有 organization_id 但 RLS 未啟用'
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    AND c.relname IN (SELECT table_name FROM org_tables)

  UNION ALL
  -- 4. SECURITY DEFINER + grant anon + 收 p_org_id（繞 RLS 的跨租戶高風險）
  SELECT '🔴 高', 'DEFINER+anon+org參數',
         (n.nspname || '.' || pr.proname),
         'SECURITY DEFINER 又給 anon、又收 p_org_id — 確認內部有 org guard'
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.prosecdef
    AND pr.proargnames @> ARRAY['p_org_id']
    AND has_function_privilege('anon', pr.oid, 'EXECUTE')
$$;

-- 只給 service_role（Studio 跑就是這個角色）；不對外，避免把漏洞清單給攻擊者
REVOKE ALL ON FUNCTION public.security_health_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_health_check() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
