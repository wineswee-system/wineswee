-- ════════════════════════════════════════════════════════════════════════════
-- Org-scope the remaining `FOR ALL TO authenticated USING (true)` catch-all
-- tables — 2026-07-02
--
-- Tables (identified from 20260424200000_lock_anon_rls_policies.sql and the
-- original creating migrations):
--   workflow_instances, workflow_steps, task_comments, task_attachments,
--   task_watchers, task_mentions, projects, project_comments,
--   project_templates, user_stores, department_manager_history,
--   org_subscriptions, org_payments, approval_chains, approval_forms,
--   approval_form_steps, employee_skills, employee_dependents,
--   employee_transfers, employee_reviews
--
-- Column verification (all 20 tables have an integer organization_id):
--   • CREATE TABLE:  projects, department_manager_history, org_subscriptions,
--     org_payments (20260417000004 / 20260416100003 / 20260416100005)
--   • Phase 1.2 backfill loop (20260420010100): workflow_instances,
--     workflow_steps, task_comments, task_attachments, task_watchers,
--     task_mentions, user_stores, approval_chains, approval_forms,
--     approval_form_steps, employee_skills, employee_dependents,
--     employee_transfers, employee_reviews
--   • 20260618120001: project_comments, project_templates
--   → no join-based child scoping is needed; every table is scoped directly.
--     Each table is still verified at runtime (information_schema) and is
--     SKIPPED with a NOTICE if organization_id is missing in that deployment.
--
-- Historical catch-all / permissive policy names being removed (per table a
-- full policy sweep is used so the final state is deterministic):
--   anon_<t> (creating migrations), auth_<t> (20260424200000),
--   anon_user_stores_dev / anon_dept_mgr_hist_dev / anon_org_sub_dev /
--   anon_org_pay_dev (20260416100008), anon_projects / auth_projects /
--   anon_project_comments / auth_project_comments (20260417000004),
--   allow_all_approval_chains / approval_chains_read (20260418000001/000005),
--   org_scope_select|insert|modify|delete_<t> (20260420010200, re-wrapped by
--   20260702600000 then superseded here), <t>_org_sel/_ins/_upd/_del
--   (20260618100000/110000/120001 — org-scoped SELECT but wide-open writes,
--   partially tightened to is_staff() by 20260618130000).
--
-- New state per regular table <t>:
--   <t>_org_sel_v2 / _org_ins_v2 / _org_upd_v2 / _org_del_v2:
--       TO authenticated,
--       organization_id = (SELECT public.current_user_org_id())
--       OR (SELECT public.is_admin())          ← helpers wrapped: once/statement
--   <t>_service: FOR ALL TO service_role USING(true) — backend jobs unaffected
--   + BEFORE INSERT trg_set_org_default (fills organization_id when the client
--     omits it, so the new WITH CHECK does not break existing insert flows —
--     WITH CHECK is evaluated after BEFORE triggers; set_org_default() exists
--     since 20260618110000)
--   + one-time backfill of NULL organization_id to the single existing org
--     (same pattern as 20260618110000) so old rows don't vanish for non-admins.
--
-- Billing exception (org_subscriptions, org_payments): SaaS billing data —
--   SELECT requires org match AND admin; NO INSERT/UPDATE/DELETE for
--   authenticated at all (service_role only). UI check: only
--   src/pages/org/Organizations.jsx + src/lib/db/org.js read these, and that
--   page is the org-admin console → admin-only read matches actual usage.
--
-- Deliberately conservative choices:
--   • employee_dependents / employee_skills / employee_transfers /
--     employee_reviews contain personal HR data; they are scoped to org here
--     (as specified). A follow-up could tighten SELECT to
--     can_see_request(employee_id) — noted, not done here, because
--     src/components/EmployeeDetail.jsx (used by office/HR staff who are not
--     always in the supervisor chain) reads and writes them.
--   • workflow_instances DELETE previously also allowed "organization_id IS
--     NULL" rows (20260501000002 fix). After the backfill + trigger no
--     NULL-org rows can exist, so the plain org-scoped DELETE is equivalent
--     in practice; NULL-org stragglers would need an admin.
--   • No table showed UI evidence of intentional cross-org reads (grepped
--     src/): all reads are org- or entity-filtered, so both reads and writes
--     are scoped.
--
-- Skipped: none — CREATE TABLE was found for all 20 tables. (Runtime guards
-- still skip gracefully with a NOTICE on deployments missing a table/column.)
--
-- Idempotent. Safe whether or not the untracked 20260702300000 / 20260702400000
-- migrations were applied. Runs after 20260702600000 (which may re-wrap
-- org_scope_* policies on these tables; they are replaced here).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Regular tables: full org-scoped CRUD + service_role bypass
-- ─────────────────────────────────────────────────────────────────────────────

DO $mig$
DECLARE
  tbls text[] := ARRAY[
    'workflow_instances','workflow_steps',
    'task_comments','task_attachments','task_watchers','task_mentions',
    'projects','project_comments','project_templates',
    'user_stores','department_manager_history',
    'approval_chains','approval_forms','approval_form_steps',
    'employee_skills','employee_dependents','employee_transfers','employee_reviews'
  ];
  t text;
  p record;
  has_org boolean;
  has_trg_fn boolean;
BEGIN
  has_trg_fn := EXISTS (
    SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
    WHERE n.nspname = 'public' AND pr.proname = 'set_org_default'
  );

  FOREACH t IN ARRAY tbls LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=t
                     AND table_type='BASE TABLE') THEN
      RAISE NOTICE 'org_scope_catchall: table % not found — skipped', t;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t
        AND column_name='organization_id'
        AND data_type IN ('integer','bigint','smallint')
    ) INTO has_org;

    IF NOT has_org THEN
      RAISE NOTICE 'org_scope_catchall: % has no integer organization_id — skipped (needs manual scoping)', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- One-time backfill so pre-trigger rows stay visible to their org
    -- (same single-org default as 20260618110000).
    EXECUTE format(
      'UPDATE public.%I SET organization_id = (SELECT MIN(id) FROM public.organizations) WHERE organization_id IS NULL',
      t);

    -- Auto-fill organization_id on INSERT so the new WITH CHECK does not
    -- break client flows that omit it.
    IF has_trg_fn THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_set_org_default ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_set_org_default BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_org_default()',
        t);
    END IF;

    -- Deterministic final state: sweep every existing policy on the table
    -- (covers all historical catch-all names listed in the header).
    FOR p IN SELECT policyname FROM pg_policies
              WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (
        organization_id = (SELECT public.current_user_org_id())
        OR (SELECT public.is_admin())
      )
    $q$, t||'_org_sel_v2', t);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
      WITH CHECK (
        organization_id = (SELECT public.current_user_org_id())
        OR (SELECT public.is_admin())
      )
    $q$, t||'_org_ins_v2', t);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
      USING (
        organization_id = (SELECT public.current_user_org_id())
        OR (SELECT public.is_admin())
      )
      WITH CHECK (
        organization_id = (SELECT public.current_user_org_id())
        OR (SELECT public.is_admin())
      )
    $q$, t||'_org_upd_v2', t);

    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
      USING (
        organization_id = (SELECT public.current_user_org_id())
        OR (SELECT public.is_admin())
      )
    $q$, t||'_org_del_v2', t);

    -- Backend jobs / edge functions keep full access.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t||'_service', t);
  END LOOP;
END
$mig$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Billing tables: admin-only SELECT (org match AND admin), writes only via
--    service_role. Historical catch-alls (anon_org_subscriptions,
--    anon_org_sub_dev, auth_org_subscriptions, anon_org_payments,
--    anon_org_pay_dev, auth_org_payments, org_scope_*) are swept.
-- ─────────────────────────────────────────────────────────────────────────────

DO $mig$
DECLARE
  tbls text[] := ARRAY['org_subscriptions','org_payments'];
  t text;
  p record;
  has_org boolean;
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=t
                     AND table_type='BASE TABLE') THEN
      RAISE NOTICE 'org_scope_catchall: table % not found — skipped', t;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t
        AND column_name='organization_id'
        AND data_type IN ('integer','bigint','smallint')
    ) INTO has_org;

    IF NOT has_org THEN
      RAISE NOTICE 'org_scope_catchall: % has no integer organization_id — skipped', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    FOR p IN SELECT policyname FROM pg_policies
              WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;

    -- Billing data: readable only by an admin of the owning org.
    EXECUTE format($q$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (
        organization_id = (SELECT public.current_user_org_id())
        AND (SELECT public.is_admin())
      )
    $q$, t||'_admin_sel', t);

    -- No authenticated INSERT/UPDATE/DELETE policies: billing rows are
    -- managed by backend jobs (service_role) only.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t||'_service', t);
  END LOOP;
END
$mig$;

COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- Verify after applying:
--
-- SELECT tablename, policyname, cmd, roles, qual
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN (
--      'workflow_instances','workflow_steps','task_comments','task_attachments',
--      'task_watchers','task_mentions','projects','project_comments',
--      'project_templates','user_stores','department_manager_history',
--      'org_subscriptions','org_payments','approval_chains','approval_forms',
--      'approval_form_steps','employee_skills','employee_dependents',
--      'employee_transfers','employee_reviews')
--  ORDER BY tablename, policyname;
--
-- Expected: per table exactly *_org_sel_v2/_org_ins_v2/_org_upd_v2/_org_del_v2
--           + *_service (billing tables: *_admin_sel + *_service only);
--           no policy with qual = 'true' for role authenticated.
--
-- Smoke test as a non-admin user of org A:
--   SELECT count(*) FROM projects;          -- only org A rows
--   SELECT count(*) FROM org_subscriptions; -- 0 rows (admin-only)
--   INSERT INTO task_comments(task_id, author, content)
--     VALUES (<own-org task>, 'me', 'hi');  -- works (trigger fills org)
-- ════════════════════════════════════════════════════════════════════════════
