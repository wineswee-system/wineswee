-- ════════════════════════════════════════════════════════════════════════════
-- 稽核日誌 / 還原已刪除單據：收進權限頁（admin 可分人）
-- 2026-06-16
--
-- 1. audit_logs RLS：被授予 audit.view 者可看完整稽核（原本只 admin 或同 org 非薪資）
-- 2. 新權限 hr_form.restore（還原已刪除單據）
-- 3. restore_request：補權限 guard（原本只檢查 org，等於任何登入者可呼叫 → 補洞）
--    控管者(admin/super_admin/manager) 或被授予 hr_form.restore 者才可還原。
--
-- 依賴 current_user_can()（20260616020000）。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. audit_logs：加 audit.view 權限者可看完整稽核 ──
DROP POLICY IF EXISTS "audit_select" ON audit_logs;
CREATE POLICY "audit_select" ON audit_logs
  FOR SELECT TO authenticated
  USING (
    current_employee_role() IN ('admin', 'super_admin')
    OR public.current_user_can('audit.view')
    OR (
      organization_id = current_employee_org()
      AND table_name NOT IN ('salary_records', 'payroll_records')
    )
  );

-- ── 2. 新權限：還原已刪除單據（給權限頁可勾）──
INSERT INTO public.permissions (code, name, module, is_system, is_active)
SELECT 'hr_form.restore', '還原已刪除單據', 'HR 表單', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.permissions WHERE code = 'hr_form.restore');

-- ── 3. restore_request：補權限 guard（其餘 body 與 20260521250000 逐字相同）──
CREATE OR REPLACE FUNCTION public.restore_request(
  p_table TEXT,
  p_id    INT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_org INT;
  v_record_org INT;
  v_emp_id     INT;
BEGIN
  -- ★ 權限 guard：控管者或被授予「還原已刪除單據」者（補原本只檢查 org 的洞）
  IF NOT (current_employee_role() IN ('admin','super_admin','manager')
          OR public.current_user_can('hr_form.restore')) THEN
    RAISE EXCEPTION 'restore_request: permission denied (need hr_form.restore)';
  END IF;

  SELECT organization_id INTO v_caller_org
  FROM public.employees
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  CASE p_table

    WHEN 'leave_requests' THEN
      SELECT employee_id INTO v_emp_id FROM public.leave_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL THEN
        SELECT organization_id INTO v_record_org FROM public.employees WHERE id = v_emp_id;
        IF v_record_org IS DISTINCT FROM v_caller_org THEN
          RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
        END IF;
      END IF;
      UPDATE public.leave_requests SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'overtime_requests' THEN
      SELECT employee_id INTO v_emp_id FROM public.overtime_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL THEN
        SELECT organization_id INTO v_record_org FROM public.employees WHERE id = v_emp_id;
        IF v_record_org IS DISTINCT FROM v_caller_org THEN
          RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
        END IF;
      END IF;
      UPDATE public.overtime_requests SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'clock_corrections' THEN
      SELECT employee_id INTO v_emp_id FROM public.clock_corrections WHERE id = p_id;
      IF v_caller_org IS NOT NULL THEN
        SELECT organization_id INTO v_record_org FROM public.employees WHERE id = v_emp_id;
        IF v_record_org IS DISTINCT FROM v_caller_org THEN
          RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
        END IF;
      END IF;
      UPDATE public.clock_corrections SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'business_trips' THEN
      SELECT organization_id INTO v_record_org FROM public.business_trips WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.business_trips SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'headcount_requests' THEN
      SELECT organization_id INTO v_record_org FROM public.headcount_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.headcount_requests SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'expense_requests' THEN
      SELECT organization_id INTO v_record_org FROM public.expense_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.expense_requests SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'form_submissions' THEN
      SELECT organization_id INTO v_record_org FROM public.form_submissions WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.form_submissions SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'shift_swaps' THEN
      SELECT organization_id INTO v_record_org FROM public.shift_swaps WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.shift_swaps SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    WHEN 'off_requests' THEN
      SELECT organization_id INTO v_record_org FROM public.off_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'restore_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.off_requests SET deleted_at = NULL, deleted_by = NULL WHERE id = p_id;

    ELSE
      RAISE EXCEPTION 'restore_request: unknown table %', p_table;
  END CASE;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
