-- ============================================================
-- 20260621160000_member_sessions.sql
-- Sprint 5 — Consumer App Auth Layer
--
-- member_sessions: magic-link token table for web/non-app access
--   (primary flow uses Supabase Auth + auth.uid(); this is fallback only)
--
-- Also adds consumer-facing RLS SELECT policies to all membership
-- tables so auth.uid() → members.auth_uid grants read access.
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. MEMBER_SESSIONS (magic-link fallback)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.member_sessions (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id        INT    NOT NULL REFERENCES public.members(id)       ON DELETE CASCADE,
  token            TEXT   NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT,
  device_info      TEXT,
  last_used_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ms_member ON public.member_sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_ms_token  ON public.member_sessions(token);
-- now() 非 IMMUTABLE，不能用於 index predicate（原寫法使本 migration 從未成功套用）
CREATE INDEX IF NOT EXISTS idx_ms_exp    ON public.member_sessions(expires_at);

ALTER TABLE public.member_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ms_staff_sel ON public.member_sessions;
CREATE POLICY ms_staff_sel ON public.member_sessions FOR SELECT USING (org_visible(organization_id));
DROP POLICY IF EXISTS ms_ins ON public.member_sessions;
CREATE POLICY ms_ins ON public.member_sessions FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS ms_upd ON public.member_sessions;
CREATE POLICY ms_upd ON public.member_sessions FOR UPDATE USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- 2. Consumer RLS: members — read own profile via auth.uid()
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS members_consumer_sel ON public.members;
CREATE POLICY members_consumer_sel ON public.members FOR SELECT
  USING (auth_uid = auth.uid());

DROP POLICY IF EXISTS members_consumer_upd ON public.members;
CREATE POLICY members_consumer_upd ON public.members FOR UPDATE
  USING (auth_uid = auth.uid())
  WITH CHECK (auth_uid = auth.uid());

-- ═══════════════════════════════════════════════════════════
-- 3. Consumer RLS: point_transactions — own history
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS pt_consumer_sel ON public.point_transactions;
CREATE POLICY pt_consumer_sel ON public.point_transactions FOR SELECT
  USING (
    member_id IN (
      SELECT id FROM public.members WHERE auth_uid = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════
-- 4. Consumer RLS: member_purchases + lines
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS mpurchase_consumer_sel ON public.member_purchases;
CREATE POLICY mpurchase_consumer_sel ON public.member_purchases FOR SELECT
  USING (
    member_id IN (
      SELECT id FROM public.members WHERE auth_uid = auth.uid()
    )
  );

DROP POLICY IF EXISTS mpl_consumer_sel ON public.member_purchase_lines;
CREATE POLICY mpl_consumer_sel ON public.member_purchase_lines FOR SELECT
  USING (
    purchase_id IN (
      SELECT mp.id FROM public.member_purchases mp
      JOIN public.members m ON m.id = mp.member_id
      WHERE m.auth_uid = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════
-- 5. Consumer RLS: coupon_assignments (guarded — table may not exist yet)
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE tablename = 'coupon_assignments' AND schemaname = 'public'
  ) THEN
    EXECUTE $p$
      DROP POLICY IF EXISTS ca_consumer_sel ON public.coupon_assignments;
      CREATE POLICY ca_consumer_sel ON public.coupon_assignments FOR SELECT
        USING (
          member_id IN (
            SELECT id FROM public.members WHERE auth_uid = auth.uid()
          )
        );
    $p$;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 6. Consumer RLS: survey_invitations
-- ═══════════════════════════════════════════════════════════

-- Member reads own invitations; token-based open access for survey link clicks
DROP POLICY IF EXISTS si_consumer_sel ON public.survey_invitations;
CREATE POLICY si_consumer_sel ON public.survey_invitations FOR SELECT
  USING (
    member_id IN (
      SELECT id FROM public.members WHERE auth_uid = auth.uid()
    )
    OR true  -- token-based access validated at app layer
  );

DROP POLICY IF EXISTS si_consumer_upd ON public.survey_invitations;
CREATE POLICY si_consumer_upd ON public.survey_invitations FOR UPDATE
  USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- 7. Consumer RLS: survey_questions — public read (needed to render form)
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS sq_public_sel ON public.survey_questions;
CREATE POLICY sq_public_sel ON public.survey_questions FOR SELECT USING (true);

-- ═══════════════════════════════════════════════════════════
-- 8. Consumer INSERT: survey_responses
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS sr_consumer_ins ON public.survey_responses;
CREATE POLICY sr_consumer_ins ON public.survey_responses FOR INSERT WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- 9. Nightly session cleanup
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.expire_member_sessions()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT;
BEGIN
  DELETE FROM public.member_sessions WHERE expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.expire_member_sessions() TO authenticated;

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('member-sessions-expire'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'member-sessions-expire',
      '30 3 * * *',
      $$ SELECT public.expire_member_sessions() $$
    );
  END IF;
END $outer$;

COMMIT;
