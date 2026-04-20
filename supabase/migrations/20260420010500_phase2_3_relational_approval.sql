-- ============================================================
-- Phase 2.3 — Convert approval_chains.steps JSONB → relational rows
--
-- Live state:
--   approval_chains: 10 rows, steps JSONB array of {role: text, label: text}
--   roles table: contains role definitions (need to lookup role names)
--
-- We create approval_chain_steps with role_id FK. Original steps JSONB column
-- is preserved (renamed to steps_legacy) until app code migrates.
--
-- Risk: MEDIUM. Role-name lookup may fail for steps where the role string
-- doesn't match a roles.name row (e.g., '人資部' may be a department not a role).
-- We log unmatched roles via RAISE NOTICE and store role_name TEXT alongside
-- nullable role_id so nothing is lost.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.approval_chain_steps (
  id SERIAL PRIMARY KEY,
  chain_id INT NOT NULL REFERENCES public.approval_chains(id) ON DELETE CASCADE,
  step_order INT NOT NULL,
  role_name TEXT NOT NULL,
  role_id INT REFERENCES public.roles(id) ON DELETE SET NULL,
  label TEXT,
  organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(chain_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_acs_chain ON public.approval_chain_steps(chain_id, step_order);
CREATE INDEX IF NOT EXISTS idx_acs_role ON public.approval_chain_steps(role_id);
CREATE INDEX IF NOT EXISTS idx_acs_org ON public.approval_chain_steps(organization_id);

-- Expand JSONB into rows (idempotent: skip if already populated)
INSERT INTO public.approval_chain_steps (chain_id, step_order, role_name, role_id, label, organization_id)
SELECT
  ac.id,
  (ord - 1)::int AS step_order,
  step->>'role' AS role_name,
  r.id AS role_id,
  step->>'label' AS label,
  ac.organization_id
FROM public.approval_chains ac,
     jsonb_array_elements(ac.steps) WITH ORDINALITY AS arr(step, ord)
LEFT JOIN public.roles r ON r.name = step->>'role'
WHERE NOT EXISTS (
  SELECT 1 FROM public.approval_chain_steps s WHERE s.chain_id = ac.id
);

-- Report unmatched role names so the operator can fix the lookup table
DO $$
DECLARE
  unmatched TEXT;
BEGIN
  SELECT string_agg(DISTINCT role_name, ', ') INTO unmatched
  FROM public.approval_chain_steps
  WHERE role_id IS NULL;
  IF unmatched IS NOT NULL THEN
    RAISE NOTICE 'approval_chain_steps with unresolved role names (role_name kept, role_id NULL): %', unmatched;
  END IF;
END $$;

-- Preserve legacy JSONB so app code can keep reading until cutover
ALTER TABLE public.approval_chains
  RENAME COLUMN steps TO steps_legacy_jsonb;

COMMENT ON COLUMN public.approval_chains.steps_legacy_jsonb IS
  'DEPRECATED. Use public.approval_chain_steps. Drop after frontend migration.';

COMMIT;
