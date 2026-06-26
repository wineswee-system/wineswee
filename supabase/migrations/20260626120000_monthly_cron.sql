-- ============================================================
-- 20260626120000_monthly_cron.sql
-- Monthly scheduled functions for CRM B2C membership
--
-- 1. upgrade_member_levels_all  — promote members based on lifetime_spend
-- 2. expire_member_points       — expire point_transactions past expires_at
-- 3. issue_birthday_rewards_monthly — issue birthday gifts on 1st of month
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. UPGRADE MEMBER LEVELS
-- Promotes members to the highest level they qualify for.
-- Requires member_levels with criteria_type = 'spending' and criteria_value = min NT$.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upgrade_member_levels_all(p_org_id BIGINT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'member_levels'
  ) THEN
    RETURN 0;
  END IF;

  -- Update members to the highest level their lifetime_spend qualifies for
  WITH best_level AS (
    SELECT DISTINCT ON (m.id)
      m.id    AS member_id,
      ml.name AS level_name
    FROM public.members m
    JOIN public.member_levels ml
      ON  ml.organization_id = p_org_id
      AND ml.criteria_type   = 'spending'
      AND m.lifetime_spend  >= ml.criteria_value
    WHERE m.organization_id = p_org_id
    ORDER BY m.id, ml.criteria_value DESC  -- highest qualifying threshold wins
  )
  UPDATE public.members m
  SET level = b.level_name
  FROM best_level b
  WHERE m.id = b.member_id
    AND (m.level IS DISTINCT FROM b.level_name);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 2. EXPIRE MEMBER POINTS
-- Marks earned point_transactions as expired when past expires_at,
-- then deducts from members.available_points.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.expire_member_points()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'point_transactions'
  ) THEN
    RETURN 0;
  END IF;

  -- Expire qualifying transactions and accumulate deductions per member
  WITH expired AS (
    UPDATE public.point_transactions
    SET type = 'expired'
    WHERE expires_at IS NOT NULL
      AND expires_at  < now()
      AND type        = 'earned'
    RETURNING member_id, points
  ),
  deductions AS (
    SELECT member_id, SUM(points) AS total
    FROM expired
    GROUP BY member_id
  )
  UPDATE public.members m
  SET available_points = GREATEST(0, COALESCE(m.available_points, 0) - d.total)
  FROM deductions d
  WHERE m.id = d.member_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. ISSUE BIRTHDAY REWARDS
-- On 1st of each month: issue points and/or coupon to members
-- whose birthday month matches the current month.
-- Idempotent: checks for existing birthday rewards in this month/year.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.issue_birthday_rewards_monthly(p_org_id BIGINT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count  INT := 0;
  v_cfg    RECORD;
  v_month  INT := EXTRACT(MONTH FROM now())::INT;
  v_year   INT := EXTRACT(YEAR  FROM now())::INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'birthday_reward_config'
  ) THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_cfg
  FROM public.birthday_reward_config
  WHERE organization_id = p_org_id
    AND enabled = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Issue birthday points
  IF (v_cfg.points IS NOT NULL AND v_cfg.points > 0)
     AND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'point_transactions')
  THEN
    INSERT INTO public.point_transactions
      (member_id, organization_id, points, type, note, expires_at)
    SELECT
      m.id, p_org_id, v_cfg.points, 'earned', '生日禮物',
      (now() + INTERVAL '90 days')::TIMESTAMPTZ
    FROM public.members m
    WHERE m.organization_id = p_org_id
      AND m.birthday_date IS NOT NULL
      AND EXTRACT(MONTH FROM m.birthday_date) = v_month
      AND NOT EXISTS (
        SELECT 1 FROM public.point_transactions pt
        WHERE pt.member_id = m.id
          AND pt.type      = 'earned'
          AND pt.note      = '生日禮物'
          AND EXTRACT(MONTH FROM pt.created_at) = v_month
          AND EXTRACT(YEAR  FROM pt.created_at) = v_year
      );

    -- Increment available_points for birthday members that received a transaction
    UPDATE public.members m
    SET available_points = COALESCE(m.available_points, 0) + v_cfg.points
    WHERE m.organization_id = p_org_id
      AND m.birthday_date IS NOT NULL
      AND EXTRACT(MONTH FROM m.birthday_date) = v_month
      AND EXISTS (
        SELECT 1 FROM public.point_transactions pt
        WHERE pt.member_id = m.id
          AND pt.type      = 'earned'
          AND pt.note      = '生日禮物'
          AND EXTRACT(MONTH FROM pt.created_at) = v_month
          AND EXTRACT(YEAR  FROM pt.created_at) = v_year
          AND pt.created_at >= (now() - INTERVAL '1 minute')
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  -- Issue birthday coupon
  IF v_cfg.coupon_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'coupon_assignments')
  THEN
    INSERT INTO public.coupon_assignments
      (coupon_id, member_id, organization_id, assignment_reason, expires_at)
    SELECT
      v_cfg.coupon_id, m.id, p_org_id, 'birthday',
      (now() + INTERVAL '30 days')::TIMESTAMPTZ
    FROM public.members m
    WHERE m.organization_id = p_org_id
      AND m.birthday_date IS NOT NULL
      AND EXTRACT(MONTH FROM m.birthday_date) = v_month
      AND NOT EXISTS (
        SELECT 1 FROM public.coupon_assignments ca
        WHERE ca.member_id  = m.id
          AND ca.coupon_id  = v_cfg.coupon_id
          AND EXTRACT(MONTH FROM ca.assigned_at) = v_month
          AND EXTRACT(YEAR  FROM ca.assigned_at) = v_year
      )
    ON CONFLICT (coupon_id, member_id) DO NOTHING;
  END IF;

  RETURN v_count;
END;
$$;

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- 4. pg_cron SCHEDULES (outside transaction — pg_cron requirement)
-- All three jobs fire on the 1st of each month at 01:00 UTC,
-- staggered by 10 minutes to avoid lock contention.
-- ═══════════════════════════════════════════════════════════

DO $outer$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly_level_upgrade') THEN
    PERFORM cron.unschedule('monthly_level_upgrade');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly_points_expiry') THEN
    PERFORM cron.unschedule('monthly_points_expiry');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly_birthday_rewards') THEN
    PERFORM cron.unschedule('monthly_birthday_rewards');
  END IF;

  PERFORM cron.schedule(
    'monthly_level_upgrade',
    '0 1 1 * *',
    'SELECT public.upgrade_member_levels_all(id) FROM public.organizations'
  );
  PERFORM cron.schedule(
    'monthly_points_expiry',
    '10 1 1 * *',
    'SELECT public.expire_member_points()'
  );
  PERFORM cron.schedule(
    'monthly_birthday_rewards',
    '20 1 1 * *',
    'SELECT public.issue_birthday_rewards_monthly(id) FROM public.organizations'
  );
END $outer$;
