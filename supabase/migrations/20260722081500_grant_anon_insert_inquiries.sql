-- ════════════════════════════════════════════════════════════════════════════
-- Allow anonymous (public) visitors to submit the inquiries form.
--
-- Context: the demo/contact + free-trial forms on the PUBLIC /showcase landing
-- page insert into `inquiries` using the anon key (no auth session). The table
-- already has an RLS policy `FOR INSERT WITH CHECK (true)` for PUBLIC, but the
-- `anon` role lacked the table-level INSERT grant, so Postgres rejected the write
-- with 42501 before RLS was ever evaluated.
--
-- Write-only by design: anon gets INSERT only (NOT select/update/delete), so
-- captured leads cannot be read back by the public key.
--
-- Two layers are needed:
--   1) table/sequence GRANT so Postgres permits the write at all, and
--   2) a permissive RLS INSERT policy scoped to the `anon` role. The existing
--      `inquiries_ins` policy checks `org_visible(organization_id)`, which is
--      false for an anonymous (org-less) visitor, so a dedicated anon policy is
--      required. Permissive policies are OR'd, so authenticated behaviour is
--      unchanged. The BEFORE INSERT `set_org_default` trigger stamps the row's
--      organization_id (defaults to the primary org), so public leads surface in
--      that org's inquiries list.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT INSERT ON public.inquiries TO anon;
-- serial PK needs sequence access for nextval() on insert
GRANT USAGE, SELECT ON SEQUENCE public.inquiries_id_seq TO anon;

DROP POLICY IF EXISTS inquiries_anon_ins ON public.inquiries;
CREATE POLICY inquiries_anon_ins ON public.inquiries
  FOR INSERT TO anon
  WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';
