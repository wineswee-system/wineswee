-- Approval delegation rules: when approver X is absent, delegate to Y for a date range
CREATE TABLE IF NOT EXISTS approval_delegation_rules (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id                bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  delegator_employee_id bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  delegate_employee_id  bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_from        date NOT NULL,
  effective_to          date,
  reason                text,
  is_active             boolean DEFAULT true,
  created_at            timestamptz DEFAULT now(),
  CONSTRAINT no_self_delegation CHECK (delegator_employee_id <> delegate_employee_id)
);

CREATE INDEX IF NOT EXISTS idx_delegation_rules_delegator ON approval_delegation_rules(delegator_employee_id);
CREATE INDEX IF NOT EXISTS idx_delegation_rules_active ON approval_delegation_rules(is_active, effective_from, effective_to);

ALTER TABLE approval_delegation_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org members manage delegation rules" ON approval_delegation_rules;
DROP POLICY IF EXISTS "delegation_rules_org_sel" ON approval_delegation_rules;
DROP POLICY IF EXISTS "delegation_rules_ins" ON approval_delegation_rules;
DROP POLICY IF EXISTS "delegation_rules_upd" ON approval_delegation_rules;
DROP POLICY IF EXISTS "delegation_rules_del" ON approval_delegation_rules;

CREATE POLICY "delegation_rules_org_sel" ON approval_delegation_rules FOR SELECT USING (org_visible(org_id));
CREATE POLICY "delegation_rules_ins" ON approval_delegation_rules FOR INSERT WITH CHECK (true);
CREATE POLICY "delegation_rules_upd" ON approval_delegation_rules FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "delegation_rules_del" ON approval_delegation_rules FOR DELETE USING (true);
