-- ============================================================
-- 20260621120000_group_compute_fn.sql
-- Sprint 3 — Group compute + preview functions
--
-- refresh_member_group(group_id) — rebuild member_group_members + update count
-- preview_member_group(org_id, criteria) — count only, no writes (safe for modal preview)
--
-- Supported criteria fields (whitelisted against SQL injection):
--   level_id, lifetime_spend, lifetime_points, visit_count, type, status
-- Supported operators: eq, neq, gte, lte
-- Top-level connector: AND | OR
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- Helper: build WHERE clause from criteria_json
-- Returns always-false clause if no valid rules exist
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._group_build_where(
  p_org_id   BIGINT,
  p_criteria JSONB
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_op      TEXT;
  v_rule    JSONB;
  v_field   TEXT;
  v_opname  TEXT;
  v_val     TEXT;
  v_clauses TEXT[] := ARRAY[]::TEXT[];
  v_clause  TEXT;
  ALLOWED   TEXT[] := ARRAY[
    'level_id','lifetime_spend','lifetime_points',
    'visit_count','type','status'
  ];
BEGIN
  v_op := COALESCE(p_criteria->>'op', 'AND');

  FOR v_rule IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_criteria->'conditions', '[]'::jsonb))
  LOOP
    v_field  := v_rule->>'field';
    v_opname := v_rule->>'operator';
    v_val    := v_rule->>'value';

    IF v_field IS NULL OR v_opname IS NULL OR v_val IS NULL THEN CONTINUE; END IF;
    IF NOT (v_field = ANY(ALLOWED))                           THEN CONTINUE; END IF;

    v_clause := CASE v_opname
      WHEN 'eq'  THEN format('%I = %L',  v_field, v_val)
      WHEN 'neq' THEN format('%I != %L', v_field, v_val)
      WHEN 'gte' THEN format('%I >= %L', v_field, v_val)
      WHEN 'lte' THEN format('%I <= %L', v_field, v_val)
      ELSE NULL
    END;

    IF v_clause IS NOT NULL THEN
      v_clauses := array_append(v_clauses, v_clause);
    END IF;
  END LOOP;

  -- No valid rules → match nothing (safety default)
  IF array_length(v_clauses, 1) IS NULL THEN
    RETURN format('organization_id = %L AND FALSE', p_org_id);
  END IF;

  RETURN format(
    'organization_id = %L AND (%s)',
    p_org_id,
    array_to_string(v_clauses, CASE v_op WHEN 'OR' THEN ' OR ' ELSE ' AND ' END)
  );
END $$;

-- ═══════════════════════════════════════════════════════════
-- refresh_member_group — rewrites membership + updates cached count
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.refresh_member_group(p_group_id BIGINT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group public.member_groups%ROWTYPE;
  v_where TEXT;
  v_count INT;
BEGIN
  SELECT * INTO v_group FROM public.member_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Static groups: membership is manual; just sync the cached count
  IF v_group.type = 'static' THEN
    SELECT COUNT(*) INTO v_count
    FROM public.member_group_members WHERE group_id = p_group_id;

    UPDATE public.member_groups
    SET member_count = v_count, last_computed_at = now(), updated_at = now()
    WHERE id = p_group_id;

    RETURN v_count;
  END IF;

  -- Dynamic: evaluate criteria and rebuild membership
  v_where := public._group_build_where(v_group.organization_id, v_group.criteria_json);

  DELETE FROM public.member_group_members WHERE group_id = p_group_id;

  EXECUTE format(
    'INSERT INTO public.member_group_members (group_id, member_id)
     SELECT %L::bigint, id FROM public.members WHERE %s
     ON CONFLICT DO NOTHING',
    p_group_id, v_where
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.member_groups
  SET member_count = v_count, last_computed_at = now(), updated_at = now()
  WHERE id = p_group_id;

  RETURN v_count;
END $$;

-- ═══════════════════════════════════════════════════════════
-- preview_member_group — count only, no state changes
-- Safe to call from the UI during criteria editing
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.preview_member_group(
  p_organization_id BIGINT,
  p_criteria        JSONB
) RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_where TEXT;
  v_count INT;
BEGIN
  v_where := public._group_build_where(p_organization_id, p_criteria);

  EXECUTE format('SELECT COUNT(*) FROM public.members WHERE %s', v_where)
  INTO v_count;

  RETURN COALESCE(v_count, 0);
END $$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.refresh_member_group(BIGINT)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_member_group(BIGINT, JSONB)   TO authenticated;
GRANT EXECUTE ON FUNCTION public._group_build_where(BIGINT, JSONB)     TO authenticated;

COMMIT;
