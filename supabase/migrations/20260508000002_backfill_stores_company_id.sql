-- Backfill stores.company_id from organization when there is exactly one
-- company per organization. Stores seeded via 20260416200001 were inserted
-- with organization_id only (no company_id), so Companies page showed 0 stores.
--
-- Safe: only fills when company count per org = 1 to avoid ambiguous assignments.

UPDATE public.stores s
SET company_id = c.id
FROM public.companies c
WHERE c.organization_id = s.organization_id
  AND s.company_id IS NULL
  AND (
    SELECT COUNT(*) FROM public.companies
    WHERE organization_id = c.organization_id
  ) = 1;

-- Also sync the TEXT company column for legacy text-based filters
UPDATE public.stores s
SET company = c.name
FROM public.companies c
WHERE s.company_id = c.id
  AND (s.company IS NULL OR s.company <> c.name);
