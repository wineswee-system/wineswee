-- ════════════════════════════════════════════════════════════════════════════
-- 緊急修補：把「寫=USING(true)」的 policy 收成「只有登入者/service」（擋 anon 公網寫入）
-- 2026-06-18
--
-- 慘案：20260618100000/110000/120000 為了「不擋建立流程」把營運/門市表的寫設成
--   FOR INSERT/UPDATE/DELETE USING(true)。但這些表 anon 本來就有 table grant →
--   等於開放「未登入 anon 從公開 API 直接改/刪」→ security_health_check 冒出 147 筆
--   🔴 致命(anon公網可達)。原本(改之前)這些表沒有寫 policy = 寫入被 RLS 擋，是安全的。
--
-- 修法：通用掃 pg_policies，找出「寫(非 SELECT)且 qual/with_check 為純 true」的 policy，
--   原地改成 USING/WITH CHECK = is_staff()（auth.role() ∈ authenticated/service_role）。
--   → anon 寫入被擋；登入者/Edge Functions 照常。scoped policy(org_visible/can_see_* /
--   is_admin)的 qual 不是 'true'，完全不動。也會順手收掉「改之前就存在」的 ALL-true 寫洞。
--
-- idempotent：可重跑(再跑時這些 policy 的 qual 已是 is_staff()，不再符合 'true' 條件)。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 受信任寫入者：登入者 or Edge Functions(service_role)。anon 不得直接寫(走 RPC)。
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT auth.role() IN ('authenticated', 'service_role');
$$;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, anon;

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname, cmd
      FROM pg_policies
     WHERE schemaname = 'public'
       AND cmd <> 'SELECT'
       AND COALESCE(NULLIF(btrim(qual), ''), 'true') = 'true'
       AND COALESCE(NULLIF(btrim(with_check), ''), 'true') = 'true'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    IF p.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (is_staff())', p.policyname, p.tablename);
    ELSIF p.cmd = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (is_staff()) WITH CHECK (is_staff())', p.policyname, p.tablename);
    ELSIF p.cmd = 'DELETE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (is_staff())', p.policyname, p.tablename);
    ELSE  -- 'ALL'
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (is_staff()) WITH CHECK (is_staff())', p.policyname, p.tablename);
    END IF;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
