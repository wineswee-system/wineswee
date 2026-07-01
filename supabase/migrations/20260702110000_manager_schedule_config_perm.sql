-- ════════════════════════════════════════════════════════════════════════════
-- Fix: Grant nav.schedule.config to the manager role.
--
-- Inconsistency: manager has schedule.edit and schedule.algo (can edit
-- schedules and run AI scheduling) but lacked nav.schedule.config, which
-- gates /hr/clock-rules and /hr/schedule-rules in both PagePermGuard and
-- the sidebar. A manager who runs the AI scheduler needs to see the rules
-- governing it.
--
-- Before: nav.schedule.config → super_admin, admin only
-- After:  nav.schedule.config → super_admin, admin, manager
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE r.name = 'manager'
   AND p.code = 'nav.schedule.config'
   AND NOT EXISTS (
     SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );

COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- Verify:
--   SELECT r.name, p.code
--     FROM role_permissions rp
--     JOIN roles r ON r.id = rp.role_id
--     JOIN permissions p ON p.id = rp.permission_id
--    WHERE p.code = 'nav.schedule.config'
--    ORDER BY r.name;
--   -- Expected rows: admin, manager, super_admin
-- ════════════════════════════════════════════════════════════════════════════
