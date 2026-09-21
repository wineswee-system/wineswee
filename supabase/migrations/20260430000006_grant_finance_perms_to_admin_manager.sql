-- ============================================================
-- Grant finance.view + finance.edit to admin and manager roles.
--
-- Background: liff_list_pending_approvals checks
-- liff_employee_has_permission(emp_id, 'finance.edit') to gate the
-- 經費 group in the LIFF approval center. Originally only super_admin
-- had this permission, so admin/manager users saw a lock icon and
-- "你的角色沒有權限審核此類單據" on the 經費 tab — even though admin
-- already had every other HR/system permission and was clearly meant
-- to handle expense approvals too.
--
-- Adds both finance.edit (gates the approval RPC) and finance.view
-- (so they can read finance pages too) to admin + manager. Idempotent
-- via ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE r.name IN ('admin', 'manager')
   AND p.code IN ('finance.edit', 'finance.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
