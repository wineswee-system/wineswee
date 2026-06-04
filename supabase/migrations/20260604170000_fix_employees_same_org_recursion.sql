-- ════════════════════════════════════════════════════════════════════════════
-- HOTFIX：employees_select_same_org 無限遞迴
--
-- 慘案：2026-06-04 上一個 migration (20260604140000) 寫的 policy:
--    USING ( organization_id IN (SELECT organization_id FROM employees WHERE ...) )
--  是在 employees 的 SELECT policy 裡又 SELECT employees → RLS 無限遞迴
--  → PostgREST 對所有 employees 查詢回 500 → 全主系統登入後白屏。
--
-- 修法：抽 SECURITY DEFINER function current_user_org_id() 拿自己 org，
--  function 內部 bypass RLS → policy 不再 self-query → 無遞迴。
--
-- 同步：function 用 STABLE + SET search_path 鎖住，避免 search_path 攻擊。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. SECURITY DEFINER helper：拿目前登入者的 organization_id ───
CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT organization_id
    FROM public.employees
   WHERE auth_user_id = auth.uid()
      OR email = (auth.jwt() ->> 'email')
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_user_org_id() IS
  'SECURITY DEFINER 取目前登入者 organization_id，給 RLS policy 用避免 self-recursion';

REVOKE ALL ON FUNCTION public.current_user_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_org_id() TO authenticated;

-- ─── 2. 砍掉壞 policy 重建 ───
DROP POLICY IF EXISTS employees_select_same_org ON public.employees;

CREATE POLICY employees_select_same_org ON public.employees
FOR SELECT TO authenticated
USING (
  organization_id = public.current_user_org_id()
);

COMMENT ON POLICY employees_select_same_org ON public.employees IS
  '同 organization 的 authenticated user 可 SELECT。'
  '用 current_user_org_id() 避免 RLS 自我遞迴。'
  '寫入仍由 employees_write_admin / employees_self_update 管。';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── 3. 健檢 ───
DO $$
DECLARE
  v_count INT;
  v_test_org INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'employees' AND cmd = 'SELECT';
  RAISE NOTICE 'employees SELECT policies 共 % 條', v_count;

  -- 試呼 function（用 superuser 跑，function 內 auth.uid() 是 null）
  BEGIN
    SELECT public.current_user_org_id() INTO v_test_org;
    RAISE NOTICE 'current_user_org_id() 可呼叫，superuser ctx 結果 = %（null 正常）', v_test_org;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'current_user_org_id() 呼叫失敗：%', SQLERRM;
  END;
END $$;
