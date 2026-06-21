-- ============================================================
-- 20260621110000_member_groups.sql
-- Sprint 3 — Member Group Builder
--
-- member_groups: dynamic (criteria-evaluated) or static (curated) lists
-- member_group_members: resolved membership cache for both types
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. MEMBER_GROUPS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.member_groups (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  type             TEXT NOT NULL DEFAULT 'dynamic'
    CHECK (type IN ('dynamic','static')),
  criteria_json    JSONB DEFAULT '{"op":"AND","conditions":[]}'::jsonb,
  member_count     INT NOT NULL DEFAULT 0,
  last_computed_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mg_org  ON public.member_groups(organization_id);
CREATE INDEX IF NOT EXISTS idx_mg_type ON public.member_groups(type);

-- ═══════════════════════════════════════════════════════════
-- 2. MEMBER_GROUP_MEMBERS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.member_group_members (
  group_id   BIGINT NOT NULL REFERENCES public.member_groups(id) ON DELETE CASCADE,
  member_id  INT    NOT NULL REFERENCES public.members(id)       ON DELETE CASCADE,
  added_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (group_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_mgm_group  ON public.member_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_mgm_member ON public.member_group_members(member_id);

-- ═══════════════════════════════════════════════════════════
-- 3. RLS
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.member_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mg_sel ON public.member_groups;
CREATE POLICY mg_sel ON public.member_groups
  FOR SELECT USING (org_visible(organization_id));

DROP POLICY IF EXISTS mg_ins ON public.member_groups;
CREATE POLICY mg_ins ON public.member_groups
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS mg_upd ON public.member_groups;
CREATE POLICY mg_upd ON public.member_groups
  FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (true);

DROP POLICY IF EXISTS mg_del ON public.member_groups;
CREATE POLICY mg_del ON public.member_groups
  FOR DELETE USING (org_visible(organization_id));

ALTER TABLE public.member_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mgm_sel ON public.member_group_members;
CREATE POLICY mgm_sel ON public.member_group_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.member_groups g
      WHERE g.id = group_id AND org_visible(g.organization_id)
    )
  );

DROP POLICY IF EXISTS mgm_ins ON public.member_group_members;
CREATE POLICY mgm_ins ON public.member_group_members
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS mgm_del ON public.member_group_members;
CREATE POLICY mgm_del ON public.member_group_members
  FOR DELETE USING (true);

-- ═══════════════════════════════════════════════════════════
-- 4. AUTO-SET org trigger
-- ═══════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_mg_set_org ON public.member_groups;
CREATE TRIGGER trg_mg_set_org
  BEFORE INSERT ON public.member_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_org_default();

COMMIT;
