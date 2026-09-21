-- ─────────────────────────────────────────────────────────────────────────────
-- resolve_errors_by_codes — Postgres RPC for automated error resolution
--
-- Called by scripts/resolve-errors.mjs from the git post-commit hook and
-- GitHub Actions CI. Runs with SECURITY DEFINER so it can UPDATE error_logs
-- even though the anon/authenticated roles are blocked by RLS on UPDATE.
--
-- Accepts an array of error codes and bulk-resolves all matching open errors.
-- Safe to call repeatedly — only affects rows where resolved = false.
--
-- Usage via Supabase JS client:
--   supabase.rpc('resolve_errors_by_codes', {
--     p_error_codes:     ['SAVE_FAILED', 'INSERT_FAILED'],
--     p_resolved_by:     'git:abc1234 (Jane)',
--     p_resolution_note: 'Added null-check before insert',
--     p_fix_reference:   'abc1234',
--   })
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION resolve_errors_by_codes(
  p_error_codes     TEXT[],
  p_resolved_by     TEXT    DEFAULT 'automation',
  p_resolution_note TEXT    DEFAULT NULL,
  p_fix_reference   TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids   BIGINT[];
  v_count INT := 0;
BEGIN
  -- Validate inputs
  IF p_error_codes IS NULL OR array_length(p_error_codes, 1) IS NULL THEN
    RETURN jsonb_build_object('resolved_count', 0, 'resolved_ids', '[]'::jsonb, 'message', 'No error codes provided');
  END IF;

  IF p_resolved_by IS NULL OR trim(p_resolved_by) = '' THEN
    RETURN jsonb_build_object('error', 'p_resolved_by is required');
  END IF;

  -- Resolve all matching open errors across all organisations
  UPDATE error_logs
  SET
    resolved        = true,
    resolved_by     = p_resolved_by,
    resolved_at     = now(),
    resolution_note = p_resolution_note,
    fix_reference   = p_fix_reference
  WHERE
    error_code = ANY(p_error_codes)
    AND resolved  = false
  RETURNING id
  INTO v_ids;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'resolved_count', v_count,
    'resolved_ids',   COALESCE(to_jsonb(v_ids), '[]'::jsonb),
    'error_codes',    to_jsonb(p_error_codes),
    'resolved_by',    p_resolved_by,
    'resolved_at',    now()
  );
END;
$$;

-- Allow the anon role (used by the local git hook + CI script via anon key)
-- and the authenticated role to call this function.
-- The SECURITY DEFINER ensures it runs with DB-owner privileges,
-- bypassing RLS regardless of the caller's role.
GRANT EXECUTE ON FUNCTION resolve_errors_by_codes(TEXT[], TEXT, TEXT, TEXT)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION resolve_errors_by_codes IS
  'Bulk-resolve open error_logs entries by error_code array. '
  'Called from git post-commit hook and GitHub Actions CI. '
  'SECURITY DEFINER — bypasses RLS. Safe to call repeatedly.';
