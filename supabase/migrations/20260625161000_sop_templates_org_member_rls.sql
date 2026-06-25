-- ════════════════════════════════════════════════════════════════════════════
-- 讓同組成員(非 admin)也能「看到 + 新增」流程範本
-- 2026-06-25
--
-- 現況(疑似老闆 Studio hotfix,migration 未反映):sop_templates 寫入閘成 is_admin
-- → 一般員工新增範本跳 RLS 錯誤;SELECT 又 org-scoped → 看不到別人/null-org 的。
--
-- 純加兩條 permissive policy(RLS 同指令多 policy 是 OR,不影響既有 admin policy):
--   ① SELECT:同 org 看得到
--   ② INSERT:帶自己 org 就能建(前端已補 organization_id)
-- UPDATE/DELETE 維持原樣(仍由既有 policy 控,通常 admin)。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS sop_templates_org_select ON public.sop_templates;
CREATE POLICY sop_templates_org_select ON public.sop_templates
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM public.employees WHERE id = public.current_employee_id()));

DROP POLICY IF EXISTS sop_templates_org_insert ON public.sop_templates;
CREATE POLICY sop_templates_org_insert ON public.sop_templates
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM public.employees WHERE id = public.current_employee_id()));

NOTIFY pgrst, 'reload schema';
