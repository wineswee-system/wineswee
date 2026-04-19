-- ============================================================
-- RBAC → Organization Scoping
-- Purpose: Connect roles/permissions to organizations so each
-- org can define its own RBAC. Add org-scoped RLS policies.
-- ============================================================

-- ─── 1. Add organization_id to roles ───

ALTER TABLE roles ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false;
  -- is_system = true for built-in roles (admin, super_admin) shared across orgs

-- Backfill: link existing roles to orgs via employees who use them
UPDATE roles r SET organization_id = (
  SELECT DISTINCT e.organization_id FROM employees e
  WHERE e.role_id = r.id AND e.organization_id IS NOT NULL
  LIMIT 1
) WHERE r.organization_id IS NULL;

-- Mark admin/super_admin as system roles
UPDATE roles SET is_system = true WHERE name IN ('admin', 'super_admin', 'manager', 'staff');

CREATE INDEX IF NOT EXISTS idx_roles_org ON roles(organization_id);

-- ─── 2. Add organization_id to permissions (optional per-org overrides) ───

ALTER TABLE permissions ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES organizations(id);
ALTER TABLE permissions ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT true;
  -- is_system = true for base permissions; org can add custom ones with is_system=false

-- ─── 3. Employee ↔ Organization membership view ───

CREATE OR REPLACE VIEW v_employee_org_role AS
SELECT
  e.id AS employee_id,
  e.name AS employee_name,
  e.email,
  e.organization_id,
  o.name AS organization_name,
  o.slug AS organization_slug,
  r.id AS role_id,
  r.name AS role_name,
  r.level AS role_level,
  r.is_system,
  e.is_manager,
  e.is_line_manager,
  e.store_id,
  e.department_id
FROM employees e
LEFT JOIN organizations o ON o.id = e.organization_id
LEFT JOIN roles r ON r.id = e.role_id;

-- ─── 4. Permission check function ───

CREATE OR REPLACE FUNCTION check_permission(p_employee_id INT, p_permission_code TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  has_perm BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = (SELECT role_id FROM employees WHERE id = p_employee_id)
      AND p.code = p_permission_code
  ) INTO has_perm;
  RETURN has_perm;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── 5. Get employee's org function ───

CREATE OR REPLACE FUNCTION get_employee_org(p_employee_id INT)
RETURNS INT AS $$
  SELECT organization_id FROM employees WHERE id = p_employee_id;
$$ LANGUAGE sql STABLE;

-- ─── 6. Upgrade RLS policies — org-scoped for new tables ───

-- organizations: only see your own org
DROP POLICY IF EXISTS org_isolation ON organizations;
DROP POLICY IF EXISTS anon_organizations ON organizations;
CREATE POLICY org_tenant_isolation ON organizations
  FOR ALL USING (
    id IN (
      SELECT organization_id FROM tenants
      WHERE id::text = coalesce(current_setting('app.tenant_id', true), '')
    )
    OR NOT EXISTS (SELECT 1 FROM tenants) -- allow if no tenants yet (first setup)
  );
-- Keep anon for development
CREATE POLICY anon_org_dev ON organizations
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- org_subscriptions: org-scoped
DROP POLICY IF EXISTS anon_org_subscriptions ON org_subscriptions;
CREATE POLICY org_sub_isolation ON org_subscriptions
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM tenants
      WHERE id::text = coalesce(current_setting('app.tenant_id', true), '')
    )
  );
CREATE POLICY anon_org_sub_dev ON org_subscriptions
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- org_payments: org-scoped
DROP POLICY IF EXISTS anon_org_payments ON org_payments;
CREATE POLICY org_pay_isolation ON org_payments
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM tenants
      WHERE id::text = coalesce(current_setting('app.tenant_id', true), '')
    )
  );
CREATE POLICY anon_org_pay_dev ON org_payments
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- user_stores: org-scoped via employee's organization
DROP POLICY IF EXISTS anon_user_stores ON user_stores;
CREATE POLICY user_stores_isolation ON user_stores
  FOR ALL USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE organization_id IN (
        SELECT organization_id FROM tenants
        WHERE id::text = coalesce(current_setting('app.tenant_id', true), '')
      )
    )
  );
CREATE POLICY anon_user_stores_dev ON user_stores
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- department_manager_history: org-scoped
DROP POLICY IF EXISTS anon_dept_mgr_history ON department_manager_history;
CREATE POLICY dept_mgr_hist_isolation ON department_manager_history
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM tenants
      WHERE id::text = coalesce(current_setting('app.tenant_id', true), '')
    )
  );
CREATE POLICY anon_dept_mgr_hist_dev ON department_manager_history
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- ─── 7. Seed default permissions if not exist ───

INSERT INTO permissions (code, name, module, description, is_system) VALUES
  ('org.read', '查看組織', 'org', '查看組織架構', true),
  ('org.write', '管理組織', 'org', '新增/編輯組織設定', true),
  ('employee.read', '查看員工', 'hr', '查看員工資料', true),
  ('employee.write', '管理員工', 'hr', '新增/編輯/刪除員工', true),
  ('schedule.read', '查看排班', 'hr', '查看排班表', true),
  ('schedule.write', '管理排班', 'hr', '編輯排班表', true),
  ('leave.approve', '核准假單', 'hr', '審核請假申請', true),
  ('leave.request', '申請請假', 'hr', '提交請假申請', true),
  ('pos.operate', 'POS 操作', 'pos', '使用收銀機', true),
  ('pos.refund', 'POS 退款', 'pos', '處理退款', true),
  ('finance.read', '查看財務', 'finance', '查看財務報表', true),
  ('finance.write', '管理財務', 'finance', '編輯財務資料', true),
  ('wms.read', '查看庫存', 'wms', '查看庫存資料', true),
  ('wms.write', '管理庫存', 'wms', '調整庫存', true),
  ('crm.read', '查看 CRM', 'crm', '查看客戶資料', true),
  ('crm.write', '管理 CRM', 'crm', '編輯客戶資料', true),
  ('pr.approve', '核准採購', 'purchase', '審核採購申請', true),
  ('report.view', '查看報表', 'analytics', '查看分析報表', true),
  ('admin.system', '系統管理', 'system', '系統設定與管理', true),
  ('line.manage', 'LINE 管理', 'line', '管理 LINE 設定', true)
ON CONFLICT (code) DO NOTHING;

-- ─── 8. Assign default permissions to system roles ───

-- Admin gets all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.is_system = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Manager gets operational permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'manager' AND p.code IN (
  'org.read', 'employee.read', 'employee.write', 'schedule.read', 'schedule.write',
  'leave.approve', 'pos.operate', 'pos.refund', 'finance.read', 'wms.read', 'wms.write',
  'crm.read', 'crm.write', 'pr.approve', 'report.view', 'line.manage'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Staff gets basic permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'staff' AND p.code IN (
  'org.read', 'employee.read', 'schedule.read', 'leave.request', 'pos.operate',
  'wms.read', 'crm.read'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
