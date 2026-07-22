-- 唯讀內省 helper:_dump_table_security — 2026-07-22
-- ════════════════════════════════════════════════════════════════════════════
-- 比照既有 _dump_function_defs,回傳指定表的 RLS 全貌(relkind/是否有 org 欄/RLS 開否 +
-- 每條 policy 的 cmd/roles/qual/with_check),供 RLS 稽核前「看清 live 再改」用。
-- 純唯讀(STABLE, SELECT only),不動任何資料/policy;REVOKE anon/authenticated,
-- 只有 service_role(bypass) 或 super_admin 場景呼叫。RLS 改動前必查,禁止瞎猜。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._dump_table_security(p_tables text[])
RETURNS TABLE(
  tbl text, relkind text, has_org boolean, rls_enabled boolean,
  policyname text, cmd text, roles text, qual text, with_check text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
  SELECT
    c.relname::text,
    c.relkind::text,
    EXISTS(SELECT 1 FROM pg_attribute a
             WHERE a.attrelid=c.oid AND a.attname='organization_id' AND NOT a.attisdropped),
    c.relrowsecurity,
    p.polname::text,
    CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                  WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                  WHEN '*' THEN 'ALL' END,
    (SELECT string_agg(rolname::text, ',') FROM pg_roles WHERE oid = ANY(p.polroles)),
    pg_get_expr(p.polqual, p.polrelid),
    pg_get_expr(p.polwithcheck, p.polrelid)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
  LEFT JOIN pg_policy p ON p.polrelid=c.oid
  WHERE c.relname = ANY(p_tables)
  ORDER BY c.relname, p.polname;
$$;

REVOKE ALL ON FUNCTION public._dump_table_security(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._dump_table_security(text[]) TO service_role;

NOTIFY pgrst, 'reload schema';
