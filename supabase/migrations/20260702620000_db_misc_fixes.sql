-- ════════════════════════════════════════════════════════════════════════════
-- DB misc fixes — 2026-07-02
--
--   1. refresh_materialized_views(): the fallback path in 20260420020200
--      silently ran a BLOCKING non-concurrent REFRESH whenever CONCURRENTLY
--      failed (e.g. MV lacks a unique index) — every 30 min via pg_cron, that
--      can stall reads on mv_daily_sales / mv_customer_revenue. Now the
--      failure RAISEs a WARNING (visible in postgres logs /
--      cron.job_run_details) and continues to the next MV. Signature
--      unchanged; the existing cron schedule keeps calling it.
--
--   2. pg_trgm GIN indexes for POS member search: members.phone and
--      members.member_number (both TEXT, verified in the 20260405053819 init
--      schema). ILIKE '%term%' member lookups currently seq-scan;
--      gin_trgm_ops makes them index-assisted.
--
--   3. public.reorder_survey_questions(p_ids bigint[]): batch reorder RPC.
--      survey_questions.id is BIGSERIAL (bigint) and has NO organization_id —
--      it scopes through surveys.organization_id (BIGINT), see
--      20260621130000_surveys.sql. The current client
--      (src/lib/db/crm.js reorderSurveyQuestions) fires N parallel UPDATEs
--      with sort_order = i (0-based); this RPC replaces that with ONE
--      statement: sort_order = ordinality - 1 (0-based, matching the client),
--      restricted to questions whose parent survey belongs to the caller's
--      org (admin bypass, consistent with the surveys RLS). Client call:
--        supabase.rpc('reorder_survey_questions', { p_ids: [...] })
--
-- Idempotent: CREATE OR REPLACE / IF NOT EXISTS / guarded DO blocks.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. refresh_materialized_views(): warn-and-continue instead of blocking
--    fallback. ACLs (REVOKE public / GRANT postgres from 20260420020200) are
--    preserved by CREATE OR REPLACE and re-asserted for fresh deployments.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_materialized_views()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  mv RECORD;
  v_failed int := 0;
BEGIN
  FOR mv IN
    SELECT n.nspname AS schema_name, c.relname AS mv_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'm' AND n.nspname = 'public'
  LOOP
    BEGIN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I.%I',
                     mv.schema_name, mv.mv_name);
    EXCEPTION WHEN OTHERS THEN
      -- Previously this fell back to a BLOCKING non-concurrent REFRESH
      -- (exclusive lock; readers stall). Record the failure and move on —
      -- an MV that cannot refresh concurrently needs a unique index, not a
      -- silent lock storm every 30 minutes.
      v_failed := v_failed + 1;
      RAISE WARNING
        'refresh_materialized_views: CONCURRENTLY refresh of %.% failed: % (SQLSTATE %) — skipped. Add a UNIQUE index to this MV to enable concurrent refresh.',
        mv.schema_name, mv.mv_name, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  IF v_failed > 0 THEN
    RAISE WARNING 'refresh_materialized_views: % materialized view(s) failed to refresh this run', v_failed;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.refresh_materialized_views() FROM public;
GRANT EXECUTE ON FUNCTION public.refresh_materialized_views() TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trigram indexes for POS member search
--    The opclass lives in whatever schema pg_trgm is installed in
--    (public on plain Postgres, often "extensions" on Supabase), so the
--    index DDL resolves the namespace dynamically.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $mig$
DECLARE
  v_ns text;
BEGIN
  SELECT n.nspname INTO v_ns
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  IF v_ns IS NULL THEN
    RAISE WARNING 'pg_trgm extension unavailable — member search trigram indexes skipped';
    RETURN;
  END IF;

  IF to_regclass('public.members') IS NULL THEN
    RAISE WARNING 'public.members not found — trigram indexes skipped';
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS members_phone_trgm_idx ON public.members USING gin (phone %I.gin_trgm_ops)',
    v_ns);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS members_member_number_trgm_idx ON public.members USING gin (member_number %I.gin_trgm_ops)',
    v_ns);
END
$mig$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Batch reorder RPC for survey questions
--    One statement instead of N parallel UPDATEs; org derived server-side.
--    sort_order is 0-based (ordinality - 1) to match the existing client
--    behavior (sort_order: i with i starting at 0).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reorder_survey_questions(p_ids bigint[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.survey_questions sq
     SET sort_order = ord.ord - 1          -- 0-based, matches client i = 0..n-1
    FROM unnest(p_ids) WITH ORDINALITY AS ord(qid, ord)
   WHERE sq.id = ord.qid
     AND EXISTS (
       SELECT 1
         FROM public.surveys s
        WHERE s.id = sq.survey_id
          AND (
            s.organization_id = (SELECT public.current_user_org_id())
            OR (SELECT public.is_admin())
          )
     );
$$;

COMMENT ON FUNCTION public.reorder_survey_questions(bigint[]) IS
  'Batch reorder: sort_order = array position (0-based). SECURITY DEFINER; '
  'only updates questions whose parent survey belongs to the caller''s org '
  '(admin bypass). Called via supabase.rpc(''reorder_survey_questions'', { p_ids }).';

REVOKE ALL ON FUNCTION public.reorder_survey_questions(bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_survey_questions(bigint[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.reorder_survey_questions(bigint[]) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- Verify after applying:
--
-- SELECT public.refresh_materialized_views();   -- as postgres: completes,
--   -- MVs without a unique index emit WARNINGs instead of taking locks.
--
-- SELECT indexname FROM pg_indexes
--  WHERE tablename = 'members' AND indexname LIKE '%trgm%';
--   → members_phone_trgm_idx, members_member_number_trgm_idx
--
-- EXPLAIN SELECT * FROM members WHERE phone ILIKE '%0912%';
--   → Bitmap Index Scan on members_phone_trgm_idx (once the planner picks it)
--
-- SELECT reorder_survey_questions(ARRAY[3,1,2]::bigint[]);  -- as org user:
--   → q3.sort_order=0, q1.sort_order=1, q2.sort_order=2 (own-org surveys only)
-- ════════════════════════════════════════════════════════════════════════════
