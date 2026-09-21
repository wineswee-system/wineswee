-- 門市稽核可見性矩陣(參考排班權限邏輯) — 2026-07-23
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:店長看自己店、督導看所管店、營運部經理看全部門市 — 但都只看「已核准」;
--       只有 admin 以上 + 稽核室 可看草稿(全狀態)。
-- 對齊排班:店長/督導 store scope = can_see_store(同排班 scopedStoreIds:store_id/manager_id/
--   user_stores/課supervisor);營運部經理全部 = liff.store_audit.view_all 權限(同 schedule.view_all)。
-- 做法:換 store_audits 兩條 SELECT policy(舊的 can_see_store 沒濾狀態→草稿也看得到)。
--   A. 全狀態(含草稿):super_admin/admin/該單稽核員本人/稽核室(新權限 store_audit.view_draft)
--   B. 只已核准+可見店:can_see_store(店長/督導) OR view_all(營運部經理)
-- 只動 SELECT;INSERT/UPDATE/DELETE(org_visible)不動。
-- ════════════════════════════════════════════════════════════════════════════

-- 1. 新權限:稽核室看草稿
INSERT INTO public.permissions (code, name, module, is_system, is_active)
SELECT 'store_audit.view_draft', '門市稽核：查看草稿(稽核室)', '門市稽核', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.permissions WHERE code = 'store_audit.view_draft');

-- 2. 自動授給「稽核室」部門在職員工(之後可在權限UI增減)
INSERT INTO public.employee_permissions (employee_id, permission_id, mode, reason)
SELECT e.id, p.id, 'grant', '稽核室自動授權(看稽核草稿)'
FROM public.employees e
JOIN public.departments d ON d.id = e.department_id AND d.name = '稽核室'
CROSS JOIN public.permissions p
WHERE p.code = 'store_audit.view_draft'
  AND e.status = '在職'
  AND NOT EXISTS (
    SELECT 1 FROM public.employee_permissions ep
    WHERE ep.employee_id = e.id AND ep.permission_id = p.id
  );

-- 3. 換 SELECT policies
DROP POLICY IF EXISTS store_audits_st_sel ON public.store_audits;
DROP POLICY IF EXISTS store_audits_view_all_sel ON public.store_audits;

-- A. 全狀態(含草稿):admin 以上 / 該單稽核員 / 稽核室
CREATE POLICY store_audits_draft_sel ON public.store_audits FOR SELECT USING (
  is_super_admin()
  OR is_admin()
  OR auditor_id = current_employee_id()
  OR current_employee_has_permission('store_audit.view_draft')
);

-- B. 只已核准 + 可見門市:店長/督導(can_see_store) OR 營運部經理(view_all,限本org)
CREATE POLICY store_audits_approved_sel ON public.store_audits FOR SELECT USING (
  status = '已核准'
  AND (
    can_see_store((store_id)::bigint)
    OR (current_employee_has_permission('liff.store_audit.view_all')
        AND organization_id = current_employee_org())
  )
);

NOTIFY pgrst, 'reload schema';
