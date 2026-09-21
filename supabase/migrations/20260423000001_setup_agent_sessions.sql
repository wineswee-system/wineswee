-- Setup Agent — audit trail for conversational project-setup sessions.
-- Stores the full transcript, applied/rejected actions, attachments metadata,
-- and final commit outcome per session for traceability.

CREATE TABLE IF NOT EXISTS setup_agent_sessions (
  id              BIGSERIAL PRIMARY KEY,
  session_id      TEXT        NOT NULL UNIQUE,
  organization_id BIGINT      REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      TEXT,
  phase           TEXT,
  draft_snapshot  JSONB,           -- final draft at commit (or latest if abandoned)
  messages        JSONB DEFAULT '[]'::jsonb,
  actions_log     JSONB DEFAULT '[]'::jsonb,
  rejected_actions JSONB DEFAULT '[]'::jsonb,
  attachments     JSONB DEFAULT '[]'::jsonb,  -- metadata only (no contents)
  committed       BOOLEAN DEFAULT false,
  committed_at    TIMESTAMPTZ,
  project_id      BIGINT,                      -- populated on successful commit
  workflow_instance_id BIGINT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_setup_agent_sessions_org ON setup_agent_sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_setup_agent_sessions_created_by ON setup_agent_sessions(created_by);
CREATE INDEX IF NOT EXISTS idx_setup_agent_sessions_committed ON setup_agent_sessions(committed);

ALTER TABLE setup_agent_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only see sessions for their own organization.
-- Admins/super_admins can see all orgs.
DROP POLICY IF EXISTS setup_agent_sessions_org_policy ON setup_agent_sessions;
CREATE POLICY setup_agent_sessions_org_policy ON setup_agent_sessions
  FOR ALL TO authenticated
  USING (
    organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  )
  WITH CHECK (
    organization_id = public.current_employee_org()
    OR public.current_employee_role() IN ('admin', 'super_admin')
  );

-- ── Storage bucket for uploads ──
-- Create the bucket if missing. Actual RLS / lifecycle rules are configured
-- via the Supabase dashboard or storage.objects policies (applied separately).
INSERT INTO storage.buckets (id, name, public)
VALUES ('setup-agent-uploads', 'setup-agent-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Auth'd users may read/write within their own org-scoped path prefix.
DROP POLICY IF EXISTS setup_agent_uploads_read ON storage.objects;
CREATE POLICY setup_agent_uploads_read ON storage.objects
  FOR SELECT USING (
    bucket_id = 'setup-agent-uploads' AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS setup_agent_uploads_write ON storage.objects;
CREATE POLICY setup_agent_uploads_write ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'setup-agent-uploads' AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS setup_agent_uploads_delete ON storage.objects;
CREATE POLICY setup_agent_uploads_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'setup-agent-uploads' AND auth.role() = 'authenticated'
  );
