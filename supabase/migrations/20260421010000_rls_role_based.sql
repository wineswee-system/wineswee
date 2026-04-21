-- ================================================
-- RLS 補齊 — 角色制資料隔離
-- attendance, salary_records, leave_requests,
-- schedules, off_requests, clock_corrections, overtime_requests
-- ================================================

-- ============ attendance ============
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_attendance ON attendance;
DROP POLICY IF EXISTS org_scope_select_attendance ON attendance;
DROP POLICY IF EXISTS org_scope_modify_attendance ON attendance;
DROP POLICY IF EXISTS org_scope_insert_attendance ON attendance;
DROP POLICY IF EXISTS org_scope_delete_attendance ON attendance;

CREATE POLICY "attendance_select" ON attendance FOR SELECT USING (
  is_admin()
  OR employee = (SELECT name FROM employees WHERE email = auth.jwt()->>'email' LIMIT 1)
);
CREATE POLICY "attendance_insert" ON attendance FOR INSERT WITH CHECK (true);
CREATE POLICY "attendance_update" ON attendance FOR UPDATE USING (is_admin());
CREATE POLICY "attendance_delete" ON attendance FOR DELETE USING (is_admin());

-- ============ salary_records ============
ALTER TABLE salary_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_salary_records ON salary_records;
DROP POLICY IF EXISTS org_scope_select_salary_records ON salary_records;
DROP POLICY IF EXISTS org_scope_modify_salary_records ON salary_records;

CREATE POLICY "salary_select" ON salary_records FOR SELECT USING (
  is_admin()
  OR employee = (SELECT name FROM employees WHERE email = auth.jwt()->>'email' LIMIT 1)
);
CREATE POLICY "salary_modify" ON salary_records FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "salary_update" ON salary_records FOR UPDATE USING (is_admin());
CREATE POLICY "salary_delete" ON salary_records FOR DELETE USING (is_admin());

-- ============ leave_requests ============
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_leave_requests ON leave_requests;
DROP POLICY IF EXISTS org_scope_select_leave_requests ON leave_requests;

CREATE POLICY "leave_select" ON leave_requests FOR SELECT USING (
  is_admin()
  OR employee = (SELECT name FROM employees WHERE email = auth.jwt()->>'email' LIMIT 1)
);
CREATE POLICY "leave_insert" ON leave_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "leave_update" ON leave_requests FOR UPDATE USING (
  is_admin()
  OR employee = (SELECT name FROM employees WHERE email = auth.jwt()->>'email' LIMIT 1)
);

-- ============ off_requests ============
ALTER TABLE off_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_off_requests ON off_requests;

CREATE POLICY "off_requests_select" ON off_requests FOR SELECT USING (
  is_admin()
  OR employee = (SELECT name FROM employees WHERE email = auth.jwt()->>'email' LIMIT 1)
);
CREATE POLICY "off_requests_insert" ON off_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "off_requests_update" ON off_requests FOR UPDATE USING (
  is_admin()
  OR employee = (SELECT name FROM employees WHERE email = auth.jwt()->>'email' LIMIT 1)
);

-- ============ clock_corrections ============
ALTER TABLE clock_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_clock_corrections ON clock_corrections;

CREATE POLICY "clock_corrections_select" ON clock_corrections FOR SELECT USING (
  is_admin()
  OR employee = (SELECT name FROM employees WHERE email = auth.jwt()->>'email' LIMIT 1)
);
CREATE POLICY "clock_corrections_insert" ON clock_corrections FOR INSERT WITH CHECK (true);
CREATE POLICY "clock_corrections_update" ON clock_corrections FOR UPDATE USING (is_admin());

-- ============ overtime_requests ============
ALTER TABLE overtime_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_overtime_requests ON overtime_requests;

CREATE POLICY "overtime_select" ON overtime_requests FOR SELECT USING (
  is_admin()
  OR employee = (SELECT name FROM employees WHERE email = auth.jwt()->>'email' LIMIT 1)
);
CREATE POLICY "overtime_insert" ON overtime_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "overtime_update" ON overtime_requests FOR UPDATE USING (
  is_admin()
  OR employee = (SELECT name FROM employees WHERE email = auth.jwt()->>'email' LIMIT 1)
);
