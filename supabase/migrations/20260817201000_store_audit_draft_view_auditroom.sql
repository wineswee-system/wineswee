-- 2026-08-17 門市稽核草稿:web 端讓「稽核室部門」也能看到草稿(→ 就能編輯,editable=isDraft + org_visible update)。
--   原本 draft SELECT 僅 super_admin / admin / 稽核員本人 / store_audit.view_draft;加上稽核室部門成員。
--   (LIFF 端 liff_update_store_audit_item 已於 20260817200000 開放 admin+稽核室草稿編輯,兩邊一致。)

DROP POLICY IF EXISTS store_audits_draft_sel ON public.store_audits;
CREATE POLICY store_audits_draft_sel ON public.store_audits FOR SELECT
USING (
  is_super_admin()
  OR (is_admin() AND organization_id = current_user_org_id())
  OR (auditor_id = current_employee_id())
  OR current_employee_has_permission('store_audit.view_draft'::text)
  OR (
    organization_id = current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.employees e
      JOIN public.departments d ON d.id = e.department_id
      WHERE e.id = current_employee_id() AND d.name = '稽核室'
    )
  )
);
