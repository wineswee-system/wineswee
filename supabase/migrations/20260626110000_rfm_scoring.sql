-- ============================================================
-- 20260626110000_rfm_scoring.sql
-- RFM Segmentation — Recency / Frequency / Monetary
--
-- 1. Add rfm columns to members
-- 2. score_rfm_all() — function that scores every member in an org
-- 3. pg_cron job to run nightly (requires pg_cron extension)
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. ADD RFM COLUMNS TO MEMBERS
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS rfm_r        SMALLINT,
  ADD COLUMN IF NOT EXISTS rfm_f        SMALLINT,
  ADD COLUMN IF NOT EXISTS rfm_m        SMALLINT,
  ADD COLUMN IF NOT EXISTS rfm_score    SMALLINT,
  ADD COLUMN IF NOT EXISTS rfm_segment  TEXT
    CHECK (rfm_segment IN ('Champions','Loyal','At Risk','Lapsed','New','Other')),
  ADD COLUMN IF NOT EXISTS rfm_scored_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_members_rfm_segment ON public.members(rfm_segment);

-- ═══════════════════════════════════════════════════════════
-- 2. SCORING FUNCTION
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.score_rfm_all(p_org_id BIGINT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_now   TIMESTAMPTZ := now();
  v_12m   TIMESTAMPTZ := v_now - INTERVAL '12 months';
BEGIN
  WITH raw AS (
    SELECT
      m.id                                         AS member_id,
      COALESCE(MAX(mp.purchased_at), m.created_at) AS last_purchase,
      COUNT(mp.id)                                  AS freq,
      COALESCE(SUM(mp.total_amount), 0)             AS monetary
    FROM public.members m
    LEFT JOIN public.member_purchases mp
      ON mp.member_id = m.id
      AND mp.purchased_at >= v_12m
      AND mp.organization_id = p_org_id
    WHERE m.organization_id = p_org_id
    GROUP BY m.id, m.created_at
  ),
  scored AS (
    SELECT
      member_id,
      NTILE(5) OVER (ORDER BY last_purchase DESC) AS r_score,
      NTILE(5) OVER (ORDER BY freq ASC)           AS f_score,
      NTILE(5) OVER (ORDER BY monetary ASC)       AS m_score
    FROM raw
  ),
  labeled AS (
    SELECT
      member_id,
      r_score, f_score, m_score,
      (r_score + f_score + m_score) AS total_score,
      CASE
        WHEN r_score >= 4 AND f_score >= 4 AND m_score >= 4 THEN 'Champions'
        WHEN f_score >= 3 AND m_score >= 3                  THEN 'Loyal'
        WHEN r_score >= 3 AND f_score <= 2                  THEN 'New'
        WHEN r_score <= 2 AND f_score >= 3                  THEN 'At Risk'
        WHEN r_score <= 2 AND f_score <= 2                  THEN 'Lapsed'
        ELSE 'Other'
      END AS segment
    FROM scored
  )
  UPDATE public.members m
  SET
    rfm_r         = l.r_score,
    rfm_f         = l.f_score,
    rfm_m         = l.m_score,
    rfm_score     = l.total_score,
    rfm_segment   = l.segment,
    rfm_scored_at = v_now
  FROM labeled l
  WHERE m.id = l.member_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. NIGHTLY CRON
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('rfm_nightly_score');
    PERFORM cron.schedule(
      'rfm_nightly_score',
      '15 0 * * *',
      $cron$
        DO $$
        DECLARE v_org BIGINT;
        BEGIN
          FOR v_org IN SELECT id FROM public.organizations LOOP
            PERFORM public.score_rfm_all(v_org);
          END LOOP;
        END;
        $$;
      $cron$
    );
  END IF;
END $$;

COMMIT;
