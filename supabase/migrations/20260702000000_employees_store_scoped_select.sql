-- ════════════════════════════════════════════════════════════════════════════
-- 收緊 employees SELECT RLS：依角色限制可讀範圍（v2）
--
-- 問題：20260604170000_fix_employees_same_org_recursion 放寬為
--       「同 org 任何 authenticated 可讀全部 employees」，導致：
--         • store_staff 透過 API 可讀到 office_staff 所有欄位
--         • manager 可讀到非自己門市（含總部 office_staff）的員工資料
--
-- 新設計（最小權限原則）：
--   is_admin / service_role → 全公司（原有 employees_select 已涵蓋 is_admin）
--   office_staff            → 同 org（內勤需全公司視野：審核、表單 JOIN、人事操作）
--   manager                 → 僅限自己門市（store_id 吻合）+ 自己
--   store_staff             → 僅限自己門市（store_id 吻合）+ 自己
--
-- 已知取捨：
--   manager 審閱跨門市申請時（極少見），applicant JOIN 可能為 null；
--   此類情境請由 admin 處理，或後續加 SECURITY DEFINER RPC 供特定頁面使用。
--
-- 注意：fn_hr_analytics / get_hr_dashboard 等 RPC 以 SECURITY DEFINER 執行，
--       不受 RLS 影響 → 那些 RPC 的門市範圍另行處理（後續 ticket）。
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Helper：取當前使用者的 store_id（SECURITY DEFINER 避免遞迴）────────
CREATE OR REPLACE FUNCTION public.current_user_store_id()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT store_id
    FROM public.employees
   WHERE auth_user_id = auth.uid()
      OR email = (auth.jwt() ->> 'email')
   ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_user_store_id() IS
  'SECURITY DEFINER 取當前登入員工的 store_id，供 RLS policy 用（避免自我遞迴）。';

REVOKE ALL ON FUNCTION public.current_user_store_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_store_id() TO authenticated;

-- ── 2. 替換舊的 employees_select_same_org policy ─────────────────────────
--    舊版：organization_id = current_user_org_id()  ← 無角色/門市區分
--    新版：分四條件 OR，逐角色給最小必要範圍

DROP POLICY IF EXISTS employees_select_same_org ON public.employees;

CREATE POLICY employees_select_same_org ON public.employees
FOR SELECT TO authenticated
USING (
  -- ① service_role（後端 RPC、Edge Function）無限制
  auth.role() = 'service_role'

  -- ② office_staff 看同 org 全部（審核/表單 JOIN/人事作業需要）
  OR (
    current_employee_role() IN ('office_staff')
    AND organization_id = current_user_org_id()
  )

  -- ③ manager 只看自己門市（store_id 為 NULL 時此條件永遠 false → 只看到自己）
  OR (
    current_employee_role() = 'manager'
    AND store_id = current_user_store_id()
  )

  -- ④ store_staff 只看自己門市
  OR (
    current_employee_role() = 'store_staff'
    AND store_id = current_user_store_id()
  )
  -- 注：is_admin() 及自身 row（auth_user_id = auth.uid()）已由
  --     employees_select policy（20260429000011）以 OR 語意涵蓋，無需重複。
);

COMMENT ON POLICY employees_select_same_org ON public.employees IS
  'v2 2026-07-02：最小權限 SELECT。'
  'service_role 無限；office_staff 全 org；manager/store_staff 限同門市 + 自身 row（由 employees_select 保障）。';

NOTIFY pgrst, 'reload schema';
