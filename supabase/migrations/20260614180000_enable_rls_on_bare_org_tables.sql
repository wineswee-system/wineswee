-- ════════════════════════════════════════════════════════════════════════════
-- 資安：5 張裸表開 RLS（有 organization_id 卻沒啟用 RLS = 無任何過濾）
--   legal_deductions / training_courses / training_enrollments
--   shift_cover_requests / quotation_lines
--
-- 用法盤點：
--   • 主系統前端「authenticated 直查」這 5 張（hr.js/sales.js/payrollCalc.js/
--     LegalDeductions.jsx/LMSAdmin.jsx/Schedule.jsx）→ policy 必須讓同 org 讀寫
--   • LIFF 0 直查（全走 RPC）→ 不受影響
--   • 守門員歸類「裸表-登入者可讀」= anon 無 grant → 開 RLS 後 anon 自動進不來
--
-- Policy 設計（單一 org 部署，零破壞優先）：
--   放行 = service_role  OR  org 為 null（舊資料 fallback）  OR  org = 本人 org
--   → 同 org 登入者全讀得到、server 端 definer/service_role 不卡、未來多 org 自動隔離
--
-- ⚠️ 開 RLS 必須同時建 policy，否則 authenticated 一筆都讀不到 → 功能壞。
--    本檔 ENABLE + CREATE POLICY 同一交易完成。idempotent（可重複跑）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $rls$
DECLARE
  t TEXT;
  bare_tables TEXT[] := ARRAY[
    'legal_deductions', 'training_courses', 'training_enrollments',
    'shift_cover_requests', 'quotation_lines'
  ];
BEGIN
  FOREACH t IN ARRAY bare_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_org_rls', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR ALL TO authenticated, service_role
        USING (
          auth.role() = 'service_role'
          OR organization_id IS NULL
          OR organization_id = public.current_employee_org()
        )
        WITH CHECK (
          auth.role() = 'service_role'
          OR organization_id IS NULL
          OR organization_id = public.current_employee_org()
        )
    $f$, t || '_org_rls', t);
  END LOOP;
END $rls$;

COMMIT;

NOTIFY pgrst, 'reload schema';
