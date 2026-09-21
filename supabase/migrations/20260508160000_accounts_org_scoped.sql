-- Make accounts org-scoped: each organization gets its own chart of accounts.

-- 1. Add organization_id (nullable while we backfill)
ALTER TABLE accounts ADD COLUMN organization_id uuid REFERENCES organizations(id);

-- 2. Drop the single-column unique constraint so we can have same code across orgs
ALTER TABLE accounts DROP CONSTRAINT accounts_code_key;

-- 3. Copy every existing (template) account row to each organization
INSERT INTO accounts (code, name, type, parent_code, balance, description, organization_id)
SELECT a.code, a.name, a.type, a.parent_code, a.balance, a.description, o.id
FROM accounts a
CROSS JOIN organizations o
WHERE a.organization_id IS NULL;

-- 4. Remove the original template rows (no org)
DELETE FROM accounts WHERE organization_id IS NULL;

-- 5. Enforce NOT NULL now that all rows have an org
ALTER TABLE accounts ALTER COLUMN organization_id SET NOT NULL;

-- 6. Composite unique: same code is allowed across different orgs
ALTER TABLE accounts ADD CONSTRAINT accounts_code_org_key UNIQUE (code, organization_id);

-- 7. Index for fast per-org queries
CREATE INDEX IF NOT EXISTS idx_accounts_organization_id ON accounts(organization_id);
