-- ════════════════════════════════════════════════════════════════════════════
-- 放寬 employees SELECT RLS：同 organization 可讀
--
-- 問題：原本 employees_select policy 只允 admin/super_admin 看所有 row，其他人
--      (manager/office_staff/store_staff) 只看得到自己 → nested JOIN 像
--      form_submissions(applicant:employees!applicant_id(...)) 對非 admin 來說
--      applicant 直接 null → 前端取 .name 拋 TypeError。
--
-- 慘案：2026-06-04 manager (張庭瑋) 列印 form_submission #10 簽呈失敗
--
-- 修法：加新的 SELECT policy 允「同 org 任意 authenticated 讀」。多個 SELECT
--      policy 在 RLS 是 OR 關係，舊的 (is_admin / self) 保留以防它策略改。
--
-- 不動：INSERT / UPDATE / DELETE policies 維持只開給 admin/super_admin 不影響。
--      自己 row update 仍可用 employees_self_update。
--
-- 敏感欄位（id_number / bank_account 等）此 patch 後 manager 可看到 —
-- 如要遮蔽請後續加 column-level mask (VIEW) 或前端 hide。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS employees_select_same_org ON public.employees;

CREATE POLICY employees_select_same_org ON public.employees
FOR SELECT TO authenticated
USING (
  organization_id IN (
    SELECT e.organization_id
      FROM public.employees e
     WHERE e.auth_user_id = auth.uid()
        OR e.email = (auth.jwt() ->> 'email')
  )
);

COMMENT ON POLICY employees_select_same_org ON public.employees IS
  '同 organization 的 authenticated user 可 SELECT，'
  '解決 manager nested JOIN 拿不到 applicant 的問題。'
  '寫入權限仍由 employees_write_admin / employees_self_update 管。';

COMMIT;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'employees' AND cmd = 'SELECT';
  RAISE NOTICE 'employees SELECT policies 共 % 條 (OR 關係，新加同 org 讀)', v_count;
END $$;
