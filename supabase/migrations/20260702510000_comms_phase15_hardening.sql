-- ════════════════════════════════════════════════════════════════════════════
-- Communications Suite — Phase 15 Hardening
--
-- 20260702400000_comms_suite.sql shipped "simple org-scoped policies" and
-- promised full hardening in Phase 15. This is that migration:
--
--   1. Junction tables (email_mailbox_members, email_thread_labels,
--      email_thread_categories, calendar_event_attendees,
--      booking_page_team_members, contact_group_members, contact_merge_log)
--      had `comms_<t>_auth` FOR ALL USING(true) policies — any authenticated
--      user of ANY org could read/write them. Replaced with join-based
--      org-scoped policies through the parent table's organization_id
--      (FOR ALL, USING + WITH CHECK). service_role policies kept.
--
--   2. comms_access_log is an audit trail: the generic FOR ALL org policy is
--      replaced by INSERT-only for authenticated (own org + own employee_id)
--      and SELECT for org admins only. No UPDATE/DELETE for authenticated.
--
--   3. booking_pages IDOR: the FOR ALL org policy let any same-org employee
--      UPDATE/DELETE anyone's booking page. Split into SELECT (org-wide,
--      acceptable — page list/team UI), INSERT (own pages, admins may create
--      ownerless/team pages), UPDATE/DELETE (owner or admin only).
--      Verified against src/lib/comms/BookingService.js: the public flow
--      reads via the anon `booking_pages_public_read` policy (kept) and
--      books via the create_booking_appointment RPC; the management UI
--      (listMyPages/savePage) operates on the caller's own pages → unbroken.
--
--   4. Performance indexes for the hot query paths (inbox list, thread view,
--      assignment queues, calendar range scans, booking dashboards,
--      notification history, contacts import queue).
--
--   5. create_booking_appointment: anon-callable SECURITY DEFINER RPC — add
--      input length caps (name 200, email 320, phone 50, answers 64 KiB) so
--      external bookers cannot stuff megabytes into text/jsonb columns.
--      Body otherwise identical to 20260702400000; search_path kept.
--
--   Intentionally NOT touched: email_categories/email_labels color seeds
--   (frontend renders the var(--...) token strings directly).
--
-- Idempotent: guarded DO blocks, DROP POLICY IF EXISTS,
-- CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Junction tables → join-based org scoping
--    (parent tables all carry organization_id)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('email_mailbox_members',     'email_mailboxes', 'mailbox_id'),
      ('email_thread_labels',       'email_threads',   'thread_id'),
      ('email_thread_categories',   'email_threads',   'thread_id'),
      ('calendar_event_attendees',  'calendar_events', 'event_id'),
      ('booking_page_team_members', 'booking_pages',   'page_id'),
      ('contact_group_members',     'contacts',        'group_id')
    ) AS v(junction, parent, fk)
  LOOP
    IF to_regclass('public.' || rec.junction) IS NULL
       OR to_regclass('public.' || rec.parent) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS "comms_%s_auth" ON public.%I', rec.junction, rec.junction);
    EXECUTE format('DROP POLICY IF EXISTS "comms_%s_org" ON public.%I', rec.junction, rec.junction);
    EXECUTE format($pol$
      CREATE POLICY "comms_%s_org" ON public.%I
        FOR ALL TO authenticated
        USING (
          public.is_admin()
          OR EXISTS (
            SELECT 1 FROM public.%I p
             WHERE p.id = %I.%I
               AND p.organization_id = public.current_user_org_id()
          )
        )
        WITH CHECK (
          public.is_admin()
          OR EXISTS (
            SELECT 1 FROM public.%I p
             WHERE p.id = %I.%I
               AND p.organization_id = public.current_user_org_id()
          )
        )
    $pol$, rec.junction, rec.junction,
           rec.parent, rec.junction, rec.fk,
           rec.parent, rec.junction, rec.fk);
    -- "comms_<t>_service" (FOR ALL TO service_role) from 20260702400000 is kept.
  END LOOP;
END $$;

-- contact_merge_log has two nullable contact FKs → scope via whichever is set
DO $$
BEGIN
  IF to_regclass('public.contact_merge_log') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "comms_contact_merge_log_auth" ON public.contact_merge_log;
  DROP POLICY IF EXISTS "comms_contact_merge_log_org"  ON public.contact_merge_log;
  CREATE POLICY "comms_contact_merge_log_org" ON public.contact_merge_log
    FOR ALL TO authenticated
    USING (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.contacts c
         WHERE c.id = COALESCE(contact_merge_log.contact_id, contact_merge_log.source_id)
           AND c.organization_id = public.current_user_org_id()
      )
    )
    WITH CHECK (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.contacts c
         WHERE c.id = COALESCE(contact_merge_log.contact_id, contact_merge_log.source_id)
           AND c.organization_id = public.current_user_org_id()
      )
    );
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2. comms_access_log — append-only audit trail
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.comms_access_log') IS NULL THEN
    RETURN;
  END IF;

  -- generic FOR ALL org policy from 20260702400000
  DROP POLICY IF EXISTS "comms_comms_access_log_org" ON public.comms_access_log;

  DROP POLICY IF EXISTS "comms_access_log_insert_self" ON public.comms_access_log;
  CREATE POLICY "comms_access_log_insert_self" ON public.comms_access_log
    FOR INSERT TO authenticated
    WITH CHECK (
      organization_id = public.current_user_org_id()
      AND employee_id = public.current_employee_id()
    );

  DROP POLICY IF EXISTS "comms_access_log_select_admin" ON public.comms_access_log;
  CREATE POLICY "comms_access_log_select_admin" ON public.comms_access_log
    FOR SELECT TO authenticated
    USING (
      organization_id = public.current_user_org_id()
      AND public.is_admin()
    );
  -- no UPDATE/DELETE policies for authenticated → blocked.
  -- "comms_comms_access_log_service" (service_role) from 20260702400000 kept.
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3. booking_pages — fix IDOR on UPDATE/DELETE
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.booking_pages') IS NULL THEN
    RETURN;
  END IF;

  -- FOR ALL org policy → split per command
  DROP POLICY IF EXISTS "comms_booking_pages_org" ON public.booking_pages;

  -- SELECT: org-wide is intended (page lists, team page setup).
  -- The anon "booking_pages_public_read" (is_active = true) policy is kept.
  DROP POLICY IF EXISTS "comms_booking_pages_select" ON public.booking_pages;
  CREATE POLICY "comms_booking_pages_select" ON public.booking_pages
    FOR SELECT TO authenticated
    USING (
      organization_id = public.current_user_org_id()
      OR public.is_admin()
    );

  -- INSERT: create pages you own; admins may create any (incl. ownerless
  -- team pages where employee_id IS NULL).
  DROP POLICY IF EXISTS "comms_booking_pages_insert" ON public.booking_pages;
  CREATE POLICY "comms_booking_pages_insert" ON public.booking_pages
    FOR INSERT TO authenticated
    WITH CHECK (
      public.is_admin()
      OR (
        organization_id = public.current_user_org_id()
        AND employee_id = public.current_employee_id()
      )
    );

  -- UPDATE/DELETE: owner or admin only (was: anyone in the org).
  DROP POLICY IF EXISTS "comms_booking_pages_update" ON public.booking_pages;
  CREATE POLICY "comms_booking_pages_update" ON public.booking_pages
    FOR UPDATE TO authenticated
    USING (
      public.is_admin()
      OR (
        organization_id = public.current_user_org_id()
        AND employee_id = public.current_employee_id()
      )
    )
    WITH CHECK (
      public.is_admin()
      OR (
        organization_id = public.current_user_org_id()
        AND employee_id = public.current_employee_id()
      )
    );

  DROP POLICY IF EXISTS "comms_booking_pages_delete" ON public.booking_pages;
  CREATE POLICY "comms_booking_pages_delete" ON public.booking_pages
    FOR DELETE TO authenticated
    USING (
      public.is_admin()
      OR (
        organization_id = public.current_user_org_id()
        AND employee_id = public.current_employee_id()
      )
    );
  -- "comms_booking_pages_service" (service_role) from 20260702400000 kept.
END $$;

-- ─────────────────────────────────────────────────────────────
-- 4. Performance indexes (columns verified in 20260702400000)
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.email_messages') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS email_messages_org_recv_active_idx
      ON public.email_messages (organization_id, received_at DESC)
      WHERE is_deleted = false;
    CREATE INDEX IF NOT EXISTS email_messages_thread_recv_idx
      ON public.email_messages (thread_id, received_at DESC);
  END IF;

  IF to_regclass('public.email_threads') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS email_threads_org_status_activity_idx
      ON public.email_threads (organization_id, thread_status, last_activity_at DESC);
    CREATE INDEX IF NOT EXISTS email_threads_assignee_status_idx
      ON public.email_threads (assigned_to_employee_id, thread_status)
      WHERE assigned_to_employee_id IS NOT NULL;
  END IF;

  IF to_regclass('public.calendar_events') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS calendar_events_org_span_idx
      ON public.calendar_events (organization_id, start_at, end_at);
    CREATE INDEX IF NOT EXISTS calendar_events_cal_start_idx
      ON public.calendar_events (calendar_id, start_at);
  END IF;

  IF to_regclass('public.booking_appointments') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS booking_appointments_status_booked_idx
      ON public.booking_appointments (status, booked_at DESC);
  END IF;

  IF to_regclass('public.notification_deliveries') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS notification_deliveries_emp_created_idx
      ON public.notification_deliveries (employee_id, created_at DESC);
  END IF;

  IF to_regclass('public.contacts_staging') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS contacts_staging_org_pending_idx
      ON public.contacts_staging (organization_id, status)
      WHERE status = 'pending';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 5. create_booking_appointment — input validation hardening
--    Signature and body identical to 20260702400000 except the
--    length/size caps added at the top.
-- ─────────────────────────────────────────────────────────────
create or replace function public.create_booking_appointment(
  p_slug          text,
  p_start_at      timestamptz,
  p_booker_name   text,
  p_booker_email  text,
  p_booker_phone  text default null,
  p_answers       jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_page booking_pages%rowtype;
  v_end_at timestamptz;
  v_appointment_id uuid;
begin
  -- ── Phase 15: input size validation (anon-callable RPC) ──
  if length(p_booker_name) > 200 then
    raise exception 'booker name too long (max 200 characters)';
  end if;
  if length(p_booker_email) > 320 then
    raise exception 'booker email too long (max 320 characters)';
  end if;
  if p_booker_phone is not null and length(p_booker_phone) > 50 then
    raise exception 'booker phone too long (max 50 characters)';
  end if;
  if p_answers is not null and octet_length(p_answers::text) > 65536 then
    raise exception 'answers payload too large (max 64 KiB)';
  end if;

  select * into v_page from booking_pages
   where slug = p_slug and is_active = true;
  if not found then
    raise exception 'booking page not found or inactive';
  end if;

  if p_start_at < now() + make_interval(hours => coalesce(v_page.advance_notice_hours, 0)) then
    raise exception 'slot violates advance notice requirement';
  end if;

  if p_booker_name is null or btrim(p_booker_name) = ''
     or p_booker_email is null or p_booker_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid booker name or email';
  end if;

  v_end_at := p_start_at + make_interval(mins => v_page.duration_minutes);

  -- reject double-booking: overlapping confirmed appointment on same page
  if exists (
    select 1 from booking_appointments a
     where a.page_id = v_page.id
       and a.status = 'confirmed'
       and a.calendar_event_id is not null
       and exists (
         select 1 from calendar_events e
          where e.id = a.calendar_event_id
            and e.start_at < v_end_at
            and e.end_at   > p_start_at
       )
  ) then
    raise exception 'slot no longer available';
  end if;

  insert into booking_appointments (
    page_id, organization_id, assigned_to_employee_id,
    booker_name, booker_email, booker_phone, booker_answers, status
  ) values (
    v_page.id, v_page.organization_id, v_page.employee_id,
    btrim(p_booker_name), lower(btrim(p_booker_email)), p_booker_phone, p_answers, 'confirmed'
  ) returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

-- re-assert grants (CREATE OR REPLACE keeps ACLs, but state is unknown)
revoke all on function public.create_booking_appointment(text, timestamptz, text, text, text, jsonb) from public;
grant execute on function public.create_booking_appointment(text, timestamptz, text, text, text, jsonb) to anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
