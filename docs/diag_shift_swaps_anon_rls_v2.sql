-- ════════════════════════════════════════════════════════════
-- shift_swaps anon 可讀性診斷 v2 — 把所有結果濃縮成一張表
-- ════════════════════════════════════════════════════════════

WITH
policies AS (
  SELECT COUNT(*) FILTER (WHERE 'anon' = ANY(roles) OR 'public' = ANY(roles)) AS anon_policy_count,
         COUNT(*) AS total_policy_count,
         string_agg(policyname || ' (' || cmd || ')', ', ' ORDER BY policyname) AS policy_list
    FROM pg_policies
   WHERE tablename = 'shift_swaps' AND schemaname = 'public'
),
grants AS (
  SELECT string_agg(grantee || ':' || privilege_type, ', ' ORDER BY grantee, privilege_type) AS anon_grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'shift_swaps'
     AND grantee IN ('anon', 'authenticated', 'public')
),
anon_visible AS (
  SELECT (SELECT COUNT(*) FROM (
    SELECT set_config('role', 'anon', true),
           1 AS x FROM public.shift_swaps WHERE status = '已核准' AND swap_date = CURRENT_DATE
  ) sub) AS rows_via_anon
),
total AS (
  SELECT COUNT(*) AS rows_total
    FROM public.shift_swaps
   WHERE status = '已核准' AND swap_date = CURRENT_DATE
)
SELECT
  p.anon_policy_count,
  p.total_policy_count,
  p.policy_list,
  g.anon_grants,
  t.rows_total            AS today_approved_total,
  '請看下面那個查詢結果' AS see_next_query_for_anon_visible
FROM policies p
CROSS JOIN grants g
CROSS JOIN total t;


-- ─── 第二個查詢：實際以 anon 身份讀讀看 ───
SET LOCAL ROLE anon;
SELECT COUNT(*) AS rows_anon_can_see
  FROM public.shift_swaps
 WHERE status = '已核准' AND swap_date = CURRENT_DATE;
RESET ROLE;
