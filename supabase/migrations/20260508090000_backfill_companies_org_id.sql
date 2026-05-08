-- Backfill organization_id on companies that still have NULL.
-- Priority: derive from linked stores, fall back to default org.

BEGIN;

-- 1. Derive from stores that link back to the company via company_id
UPDATE companies c
SET organization_id = s.organization_id
FROM (
  SELECT DISTINCT ON (company_id) company_id, organization_id
  FROM stores
  WHERE company_id IS NOT NULL AND organization_id IS NOT NULL
  ORDER BY company_id, organization_id
) s
WHERE c.id = s.company_id
  AND c.organization_id IS NULL;

-- 2. Fall back to the first org for any remaining NULLs
UPDATE companies
SET organization_id = (SELECT id FROM organizations ORDER BY id LIMIT 1)
WHERE organization_id IS NULL;

COMMIT;
