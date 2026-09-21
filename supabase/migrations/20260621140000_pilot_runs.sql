-- ============================================================
-- 20260621140000_pilot_runs.sql
-- Sprint 4 — Pilot Runs
--
-- pilot_runs: test dispatches targeting a member group before full rollout
-- Also wires survey_invitations.pilot_run_id FK
-- launch_pilot_run(id) — creates invitations for the target group
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. PILOT_RUNS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pilot_runs (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  survey_id        BIGINT NOT NULL REFERENCES public.surveys(id)       ON DELETE CASCADE,
  group_id         BIGINT REFERENCES public.member_groups(id)          ON DELETE SET NULL,
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','running','completed','approved','rejected')),
  target_count     INT NOT NULL DEFAULT 0,
  sent_count       INT NOT NULL DEFAULT 0,
  response_count   INT NOT NULL DEFAULT 0,
  response_rate    NUMERIC(5,2) NOT NULL DEFAULT 0,
  decision         TEXT CHECK (decision IN ('approve','reject')),
  decision_notes   TEXT,
  decided_at       TIMESTAMPTZ,
  decided_by       TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pr_org    ON public.pilot_runs(organization_id);
CREATE INDEX IF NOT EXISTS idx_pr_survey ON public.pilot_runs(survey_id);
CREATE INDEX IF NOT EXISTS idx_pr_status ON public.pilot_runs(status);

DROP TRIGGER IF EXISTS trg_pr_set_org ON public.pilot_runs;
CREATE TRIGGER trg_pr_set_org
  BEFORE INSERT ON public.pilot_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_org_default();

-- ═══════════════════════════════════════════════════════════
-- 2. Wire pilot_run_id FK on survey_invitations (deferred from surveys migration)
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_si_pilot_run'
  ) THEN
    ALTER TABLE public.survey_invitations
      ADD CONSTRAINT fk_si_pilot_run
      FOREIGN KEY (pilot_run_id) REFERENCES public.pilot_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 3. launch_pilot_run — batch-create invitations from group
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.launch_pilot_run(p_pilot_run_id BIGINT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pilot   public.pilot_runs%ROWTYPE;
  v_survey  public.surveys%ROWTYPE;
  v_member  RECORD;
  v_count   INT := 0;
  v_send_at TIMESTAMPTZ;
  v_expires TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_pilot FROM public.pilot_runs WHERE id = p_pilot_run_id;
  IF NOT FOUND OR v_pilot.status <> 'draft' THEN RETURN 0; END IF;

  SELECT * INTO v_survey FROM public.surveys WHERE id = v_pilot.survey_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_send_at := now() + (v_survey.trigger_delay_hours || ' hours')::INTERVAL;
  v_expires := v_send_at + (v_survey.expires_in_days || ' days')::INTERVAL;

  IF v_pilot.group_id IS NOT NULL THEN
    FOR v_member IN
      SELECT member_id FROM public.member_group_members WHERE group_id = v_pilot.group_id
    LOOP
      INSERT INTO public.survey_invitations
        (survey_id, member_id, organization_id, status, send_after, expires_at, pilot_run_id)
      VALUES
        (v_pilot.survey_id, v_member.member_id, v_pilot.organization_id,
         'pending', v_send_at, v_expires, p_pilot_run_id)
      ON CONFLICT (survey_id, member_id, pilot_run_id) DO NOTHING;

      v_count := v_count + 1;
    END LOOP;
  END IF;

  UPDATE public.pilot_runs
  SET status = 'running', target_count = v_count, updated_at = now()
  WHERE id = p_pilot_run_id;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.launch_pilot_run(BIGINT) TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 4. RLS
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.pilot_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pr_sel ON public.pilot_runs;
CREATE POLICY pr_sel ON public.pilot_runs FOR SELECT USING (org_visible(organization_id));
DROP POLICY IF EXISTS pr_ins ON public.pilot_runs;
CREATE POLICY pr_ins ON public.pilot_runs FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS pr_upd ON public.pilot_runs;
CREATE POLICY pr_upd ON public.pilot_runs FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (true);
DROP POLICY IF EXISTS pr_del ON public.pilot_runs;
CREATE POLICY pr_del ON public.pilot_runs FOR DELETE USING (org_visible(organization_id));

COMMIT;
