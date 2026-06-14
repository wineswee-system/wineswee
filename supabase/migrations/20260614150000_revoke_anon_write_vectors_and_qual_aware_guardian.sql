-- ════════════════════════════════════════════════════════════════════════════
-- 資安 Wave 1.5：關掉真正 anon 可達的洞 + 守門員改成「看得懂 qual」
--
-- Wave 1 撤了敏感表 grant 後，重跑守門員，🔴 致命還是一長串——但多數其實安全：
--   它們的 qual 是 is_admin() / current_employee_role() / auth.uid()，對 anon 一律
--   回 null/false → anon 一筆都讀不到。守門員無法在靜態下評估 qual，才誤報。
--
-- 真正 anon 打得到的只有「qual=true / 無 with_check」這種：
--   A. department_sections_read_all（SELECT true）→ anon 可讀整個組織圖
--   B. clock_corrections / off_requests / goods_transfer_* 的 anon INSERT（無 check）
--      → anon 拿 public key 就能往 DB 灌髒資料（spam vector）
--   這些 LIFF 全走 SECURITY DEFINER RPC（liff_insert_clock_correction /
--   liff_insert_off_request / liff_insert_transfer_request），不靠 anon 直查 → 撤 grant 零破壞。
--
-- 仍保留（LIFF 有直查，要先改 RPC 才能 REVOKE）：
--   expense_request_attachments / approval_extra_steps / form_attachments
--
-- 同時把 security_health_check() 升級成 qual-aware：
--   🔴 致命 = anon 有 grant + policy 給 anon + qual/with_check 真的放行（true/null）
--   🔵 低   = anon 有 grant 但 qual 應已過濾（人工複查，特別留意含 "IS NULL" 的）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── A. 撤掉真正 anon 可達的表 grant（LIFF 全走 RPC，已驗證 0 直查）─────────────
DO $revoke$
DECLARE
  t TEXT;
  anon_reachable TEXT[] := ARRAY[
    'department_sections',      -- SELECT true：anon 可讀組織圖
    'clock_corrections',        -- anon INSERT 無 check：spam vector（LIFF 走 RPC）
    'off_requests',             -- 同上
    'goods_transfer_requests',  -- 同上
    'goods_transfer_items'      -- 同上
  ];
BEGIN
  FOREACH t IN ARRAY anon_reachable LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END $revoke$;


-- ─── B. 守門員升級：qual-aware ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.security_health_check()
RETURNS TABLE(severity TEXT, category TEXT, object TEXT, detail TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
  WITH org_tables AS (
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id'
  ),
  pol AS (
    SELECT
      p.tablename, p.policyname, p.cmd, p.qual, p.with_check, p.roles,
      ('anon' = ANY(p.roles) OR 'public' = ANY(p.roles)) AS targets_anon,
      ('authenticated' = ANY(p.roles) OR 'public' = ANY(p.roles)) AS targets_auth,
      CASE p.cmd
        WHEN 'SELECT' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'SELECT')
        WHEN 'INSERT' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'INSERT')
        WHEN 'UPDATE' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'UPDATE')
        WHEN 'DELETE' THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'DELETE')
        WHEN 'ALL'    THEN has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'SELECT')
                        OR has_table_privilege('anon', ('public.'||p.tablename)::regclass, 'INSERT')
        ELSE false
      END AS anon_has_grant,
      -- qual/with_check 是否「真的放行 anon」（true 或 null = 無過濾）
      CASE p.cmd
        WHEN 'SELECT' THEN p.qual = 'true'
        WHEN 'DELETE' THEN p.qual = 'true'
        WHEN 'UPDATE' THEN p.qual = 'true' OR p.with_check = 'true'
        WHEN 'INSERT' THEN p.with_check IS NULL OR p.with_check = 'true'
        WHEN 'ALL'    THEN p.qual = 'true' OR p.with_check = 'true'
                        OR (p.qual IS NULL AND p.with_check IS NULL)
        ELSE false
      END AS is_permissive
    FROM pg_policies p
    WHERE p.schemaname = 'public'
  )

  -- 1. 🔴 致命：anon 有 grant + 給 anon + qual/with_check 真的放行
  SELECT '🔴 致命(anon公網可達)'::text, 'anon直達'::text,
         (pol.tablename || ' / ' || pol.policyname)::text,
         ('cmd=' || pol.cmd || '  放行='
          || CASE pol.cmd WHEN 'INSERT' THEN COALESCE(left(pol.with_check,30),'NULL(無check)')
                          ELSE COALESCE(left(pol.qual,30),'NULL') END)::text
  FROM pol
  WHERE pol.targets_anon AND pol.anon_has_grant AND pol.is_permissive

  UNION ALL
  -- 2. 🟠 高：登入者跨租戶（USING(true) + authenticated 可達）
  SELECT '🟠 高(登入者跨租戶)', '完全開放USING(true)',
         (pol.tablename || ' / ' || pol.policyname),
         ('cmd=' || pol.cmd || ' — 任何登入者(不分org)全' ||
          CASE pol.cmd WHEN 'SELECT' THEN '看' ELSE '改' END)
  FROM pol
  WHERE pol.qual = 'true' AND pol.cmd IN ('SELECT', 'ALL')
    AND pol.targets_auth
    AND NOT (pol.targets_anon AND pol.anon_has_grant AND pol.is_permissive)

  UNION ALL
  -- 3. 🔴 致命：org 表沒 RLS 且 anon/authenticated 拿得到 grant（裸表）
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

  UNION ALL
  -- 5. 🔵 低：anon 有 grant 但 qual 應已過濾（人工複查，留意含 "IS NULL" 的洩漏 null-org 列）
  SELECT '🔵 低(anon有grant待複查)', 'anon-qual應已過濾',
         (pol.tablename || ' / ' || pol.policyname),
         ('cmd=' || pol.cmd || '  qual=' || COALESCE(left(pol.qual,50),'NULL')
          || CASE WHEN pol.qual ILIKE '%is null%' THEN '  ⚠️含IS NULL' ELSE '' END)
  FROM pol
  WHERE pol.targets_anon AND pol.anon_has_grant AND NOT pol.is_permissive
    AND pol.cmd IN ('SELECT', 'ALL')
$$;

REVOKE ALL ON FUNCTION public.security_health_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_health_check() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
