-- ============================================================
-- 20260621130000_surveys.sql
-- Sprint 4 — Survey Engine
--
-- surveys: configurable post-purchase / manual surveys
-- survey_questions: ordered question list per survey
-- survey_invitations: per-member dispatch queue (processed by cron)
-- survey_responses: raw answers per question per invitation
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. SURVEYS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.surveys (
  id                  BIGSERIAL PRIMARY KEY,
  organization_id     BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','paused','closed')),
  trigger_type        TEXT NOT NULL DEFAULT 'post_purchase'
    CHECK (trigger_type IN ('post_purchase','manual')),
  trigger_delay_hours INT NOT NULL DEFAULT 24,
  send_channel        TEXT NOT NULL DEFAULT 'line'
    CHECK (send_channel IN ('line','sms','email')),
  expires_in_days     INT NOT NULL DEFAULT 7,
  min_purchase_amount NUMERIC(12,2),
  target_level_id     INT REFERENCES public.member_levels(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_surveys_org    ON public.surveys(organization_id);
CREATE INDEX IF NOT EXISTS idx_surveys_status ON public.surveys(status);

DROP TRIGGER IF EXISTS trg_surveys_set_org ON public.surveys;
CREATE TRIGGER trg_surveys_set_org
  BEFORE INSERT ON public.surveys
  FOR EACH ROW EXECUTE FUNCTION public.set_org_default();

-- ═══════════════════════════════════════════════════════════
-- 2. SURVEY_QUESTIONS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.survey_questions (
  id          BIGSERIAL PRIMARY KEY,
  survey_id   BIGINT NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  sort_order  INT NOT NULL DEFAULT 0,
  type        TEXT NOT NULL
    CHECK (type IN ('nps','rating','single_choice','multi_choice','text')),
  question    TEXT NOT NULL,
  options     JSONB NOT NULL DEFAULT '[]'::jsonb,
  required    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_sq_survey ON public.survey_questions(survey_id, sort_order);

-- ═══════════════════════════════════════════════════════════
-- 3. SURVEY_INVITATIONS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.survey_invitations (
  id               BIGSERIAL PRIMARY KEY,
  survey_id        BIGINT NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  member_id        INT    NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  organization_id  BIGINT NOT NULL,
  purchase_id      BIGINT REFERENCES public.member_purchases(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','responded','expired','failed')),
  send_after       TIMESTAMPTZ NOT NULL,
  sent_at          TIMESTAMPTZ,
  responded_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ NOT NULL,
  token            TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT,
  pilot_run_id     BIGINT,    -- FK constraint added by pilot_runs migration
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (survey_id, member_id, pilot_run_id)
);

CREATE INDEX IF NOT EXISTS idx_si_survey  ON public.survey_invitations(survey_id);
CREATE INDEX IF NOT EXISTS idx_si_member  ON public.survey_invitations(member_id);
CREATE INDEX IF NOT EXISTS idx_si_status  ON public.survey_invitations(status);
CREATE INDEX IF NOT EXISTS idx_si_send    ON public.survey_invitations(send_after)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_si_token   ON public.survey_invitations(token);

-- ═══════════════════════════════════════════════════════════
-- 4. SURVEY_RESPONSES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.survey_responses (
  id             BIGSERIAL PRIMARY KEY,
  invitation_id  BIGINT NOT NULL REFERENCES public.survey_invitations(id) ON DELETE CASCADE,
  survey_id      BIGINT NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  member_id      INT REFERENCES public.members(id) ON DELETE SET NULL,
  question_id    BIGINT NOT NULL REFERENCES public.survey_questions(id) ON DELETE CASCADE,
  answer_text    TEXT,
  answer_number  NUMERIC(6,2),
  answer_options JSONB DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (invitation_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_sr_invitation ON public.survey_responses(invitation_id);
CREATE INDEX IF NOT EXISTS idx_sr_survey     ON public.survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_sr_question   ON public.survey_responses(question_id);

-- ═══════════════════════════════════════════════════════════
-- 5. RLS
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS surveys_sel ON public.surveys;
CREATE POLICY surveys_sel ON public.surveys FOR SELECT USING (org_visible(organization_id));
DROP POLICY IF EXISTS surveys_ins ON public.surveys;
CREATE POLICY surveys_ins ON public.surveys FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS surveys_upd ON public.surveys;
CREATE POLICY surveys_upd ON public.surveys FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (true);
DROP POLICY IF EXISTS surveys_del ON public.surveys;
CREATE POLICY surveys_del ON public.surveys FOR DELETE USING (org_visible(organization_id));

ALTER TABLE public.survey_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sq_sel ON public.survey_questions;
CREATE POLICY sq_sel ON public.survey_questions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.surveys s WHERE s.id = survey_id AND org_visible(s.organization_id))
);
DROP POLICY IF EXISTS sq_write ON public.survey_questions;
CREATE POLICY sq_write ON public.survey_questions FOR ALL WITH CHECK (true);

ALTER TABLE public.survey_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS si_sel ON public.survey_invitations;
CREATE POLICY si_sel ON public.survey_invitations FOR SELECT USING (org_visible(organization_id));
DROP POLICY IF EXISTS si_ins ON public.survey_invitations;
CREATE POLICY si_ins ON public.survey_invitations FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS si_upd ON public.survey_invitations;
CREATE POLICY si_upd ON public.survey_invitations FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (true);

ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sr_sel ON public.survey_responses;
CREATE POLICY sr_sel ON public.survey_responses FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.survey_invitations si
    WHERE si.id = invitation_id AND org_visible(si.organization_id)
  )
);
DROP POLICY IF EXISTS sr_ins ON public.survey_responses;
CREATE POLICY sr_ins ON public.survey_responses FOR INSERT WITH CHECK (true);

COMMIT;
