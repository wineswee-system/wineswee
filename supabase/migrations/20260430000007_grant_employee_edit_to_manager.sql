-- ============================================================
-- Grant employee.edit to the manager role.
--
-- Store managers / department managers need to edit basic employee
-- info (phone, schedule notes, store assignment, etc.) without
-- escalating to admin. Idempotent.
-- ============================================================

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE r.name = 'manager'
   AND p.code = 'employee.edit'
ON CONFLICT (role_id, permission_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
