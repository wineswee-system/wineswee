-- ════════════════════════════════════════════════════════════
-- shift_swaps anon 可讀性診斷
-- 在 Supabase Studio SQL editor 跑這份，把結果丟回給我看
-- ════════════════════════════════════════════════════════════

-- ─── 1. shift_swaps 表上的 RLS 開關 ───
SELECT
  n.nspname        AS schema,
  c.relname        AS table_name,
  c.relrowsecurity AS rls_enabled,   -- true = RLS on (沒 policy 就 deny-all)
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname = 'shift_swaps' AND n.nspname = 'public';


-- ─── 2. shift_swaps 上所有 policy ───
SELECT
  policyname,
  permissive,
  roles,
  cmd,                            -- SELECT / INSERT / UPDATE / DELETE / ALL
  qual           AS using_clause,
  with_check     AS with_check_clause
FROM pg_policies
WHERE tablename = 'shift_swaps' AND schemaname = 'public'
ORDER BY policyname;


-- ─── 3. anon 對 shift_swaps 有什麼 table-level 權限 ───
SELECT
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'shift_swaps'
  AND grantee IN ('anon', 'authenticated', 'public', 'service_role')
ORDER BY grantee, privilege_type;


-- ─── 4. 模擬 anon 視角實際讀讀看（最直接的判斷）───
--    set role anon 後 SELECT，回 0 筆 = RLS 擋；回 > 0 = anon 看得到
SET LOCAL ROLE anon;
SELECT COUNT(*) AS anon_visible_rows
  FROM public.shift_swaps
 WHERE status = '已核准' AND swap_date = CURRENT_DATE;
RESET ROLE;


-- ─── 5. 對照：service_role 視角看到幾筆（基準）───
SELECT COUNT(*) AS total_approved_today
  FROM public.shift_swaps
 WHERE status = '已核准' AND swap_date = CURRENT_DATE;
