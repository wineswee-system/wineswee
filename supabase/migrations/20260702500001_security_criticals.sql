-- ════════════════════════════════════════════════════════════════════════════
-- Security Criticals — 2026-07-02
--
-- Fixes four critical findings from the security review:
--
--   1. secure_update_employee(INT, JSONB) was executable by anon
--      (20260426040006 granted to authenticated AND anon). The function is
--      SECURITY DEFINER and dynamically updates employees — anon must never
--      call it. Revoke anon, keep authenticated (in-function role checks
--      via current_employee_role()/current_employee_id() still apply).
--
--   2. store_events had a blanket catch-all policy
--      ("Allow all for authenticated" USING(true) from 20260413000001),
--      letting any logged-in user of ANY org read/write ANY store's calendar
--      events. Rebuilt: SELECT org-scoped through the stores join
--      (store_events has store_id; organization_id was backfilled by phase
--      1.2 but is not reliably set on new UI inserts, so the stores join is
--      the source of truth). Writes limited to admin / office_staff (own org)
--      / manager (own store). service_role bypass kept.
--      UI verified: src/pages/hr/Schedule.jsx reads per selected store
--      (office_staff may browse all org stores → org-wide SELECT);
--      src/pages/hr/components/ScheduleCalendarEvents.jsx inserts/deletes
--      only store_id/date/title/color (covered by the write policies).
--
--   3. business_events / dead_letter_queue are audit/event streams and must
--      be append-only for regular users. business_events: REVOKE UPDATE,
--      DELETE from anon+authenticated (no UPDATE/DELETE policies existed,
--      this is grant-level defense in depth). dead_letter_queue: REVOKE
--      DELETE from anon+authenticated and replace the blanket
--      dlq_update_auth policy (any authenticated could tamper with
--      status/retry_count) with an admin-only UPDATE policy — kept (instead
--      of a full UPDATE revoke) because the dlq.retry job handler
--      (src/lib/jobQueue.js) updates DLQ rows from an authenticated session;
--      that flow is admin tooling, so is_admin() is the right scope.
--      Deletes are handled by the service-side cron (run_log_cleanup,
--      SECURITY DEFINER) and are unaffected.
--
--   4. event_outbox — ensure RLS is enabled with policies. 20260618120001
--      already creates an admin/service-only policy; this re-asserts RLS and
--      recreates the policy only if the table somehow has none (deployment
--      state unknown).
--
-- Idempotent: guarded DO blocks, DROP POLICY IF EXISTS, re-runnable REVOKEs.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. secure_update_employee — revoke anon EXECUTE
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.secure_update_employee(int, jsonb)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.secure_update_employee(INT, JSONB) FROM anon;
    -- keep authenticated (function enforces caller role/self checks internally)
    GRANT EXECUTE ON FUNCTION public.secure_update_employee(INT, JSONB) TO authenticated;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2. store_events — replace catch-all policies with scoped ones
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  p record;
BEGIN
  IF to_regclass('public.store_events') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.store_events ENABLE ROW LEVEL SECURITY;

  -- Drop the known catch-alls…
  DROP POLICY IF EXISTS "Allow all for authenticated" ON public.store_events;
  DROP POLICY IF EXISTS "Allow anon read"   ON public.store_events;
  DROP POLICY IF EXISTS "Allow anon insert" ON public.store_events;
  DROP POLICY IF EXISTS "Allow anon update" ON public.store_events;
  DROP POLICY IF EXISTS "Allow anon delete" ON public.store_events;

  -- …and anything else lingering on the table (20260618130000/160000 may
  -- have rewritten catch-alls under other names; a full sweep guarantees
  -- the final state before rebuilding).
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'store_events'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.store_events', p.policyname);
  END LOOP;

  -- service_role bypass (edge functions / server jobs)
  CREATE POLICY store_events_service ON public.store_events
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

  -- SELECT: admins everywhere; everyone else only events of stores in their
  -- own org (office_staff needs all org stores for the schedule page; the
  -- stores join is authoritative even when organization_id is NULL).
  CREATE POLICY store_events_select ON public.store_events
    FOR SELECT TO authenticated
    USING (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.stores s
         WHERE s.id = store_events.store_id
           AND s.organization_id = public.current_user_org_id()
      )
    );

  -- Writes: admin (anywhere) / office_staff (any store in own org) /
  -- manager (own store only). store_staff cannot write calendar markers.
  CREATE POLICY store_events_insert ON public.store_events
    FOR INSERT TO authenticated
    WITH CHECK (
      public.is_admin()
      OR (
        public.current_employee_role() = 'office_staff'
        AND EXISTS (
          SELECT 1 FROM public.stores s
           WHERE s.id = store_events.store_id
             AND s.organization_id = public.current_user_org_id()
        )
      )
      OR (
        public.current_employee_role() = 'manager'
        AND store_events.store_id = public.current_user_store_id()
      )
    );

  CREATE POLICY store_events_update ON public.store_events
    FOR UPDATE TO authenticated
    USING (
      public.is_admin()
      OR (
        public.current_employee_role() = 'office_staff'
        AND EXISTS (
          SELECT 1 FROM public.stores s
           WHERE s.id = store_events.store_id
             AND s.organization_id = public.current_user_org_id()
        )
      )
      OR (
        public.current_employee_role() = 'manager'
        AND store_events.store_id = public.current_user_store_id()
      )
    )
    WITH CHECK (
      public.is_admin()
      OR (
        public.current_employee_role() = 'office_staff'
        AND EXISTS (
          SELECT 1 FROM public.stores s
           WHERE s.id = store_events.store_id
             AND s.organization_id = public.current_user_org_id()
        )
      )
      OR (
        public.current_employee_role() = 'manager'
        AND store_events.store_id = public.current_user_store_id()
      )
    );

  CREATE POLICY store_events_delete ON public.store_events
    FOR DELETE TO authenticated
    USING (
      public.is_admin()
      OR (
        public.current_employee_role() = 'office_staff'
        AND EXISTS (
          SELECT 1 FROM public.stores s
           WHERE s.id = store_events.store_id
             AND s.organization_id = public.current_user_org_id()
        )
      )
      OR (
        public.current_employee_role() = 'manager'
        AND store_events.store_id = public.current_user_store_id()
      )
    );
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3. business_events / dead_letter_queue — append-only for users
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.business_events') IS NOT NULL THEN
    -- audit stream: clients may INSERT (auditLogger middleware) and read,
    -- but never mutate or erase history. Cleanup runs as SECURITY DEFINER
    -- cron (run_log_cleanup) and is unaffected.
    REVOKE UPDATE, DELETE ON public.business_events FROM anon, authenticated;
  END IF;

  IF to_regclass('public.dead_letter_queue') IS NOT NULL THEN
    REVOKE DELETE ON public.dead_letter_queue FROM anon, authenticated;
    REVOKE UPDATE ON public.dead_letter_queue FROM anon;
    -- Replace blanket authenticated UPDATE with admin-only:
    -- dlq.retry admin tooling (src/lib/jobQueue.js) keeps working for
    -- admins; regular staff can no longer tamper with status/retry_count.
    DROP POLICY IF EXISTS "dlq_update_auth"  ON public.dead_letter_queue;
    DROP POLICY IF EXISTS "dlq_update_admin" ON public.dead_letter_queue;
    CREATE POLICY "dlq_update_admin" ON public.dead_letter_queue
      FOR UPDATE
      USING (public.is_admin() OR auth.role() = 'service_role')
      WITH CHECK (public.is_admin() OR auth.role() = 'service_role');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 4. event_outbox — ensure RLS enabled with at least one policy
--    (20260618120001 normally creates event_outbox_admin_only)
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.event_outbox') IS NOT NULL THEN
    ALTER TABLE public.event_outbox ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'event_outbox'
    ) THEN
      -- table has no organization_id/tenant column (see 20260415000002) →
      -- admin/service only, matching 20260618120001's intended state.
      CREATE POLICY event_outbox_admin_only ON public.event_outbox
        FOR ALL
        USING (public.is_admin() OR auth.role() = 'service_role')
        WITH CHECK (public.is_admin() OR auth.role() = 'service_role');
    END IF;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
