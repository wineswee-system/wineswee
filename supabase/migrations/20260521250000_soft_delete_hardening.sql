-- ════════════════════════════════════════════════════════════════════════════
-- Soft Delete 安全補強
--
-- 1. soft_delete_request()  — 加 org 驗證（caller 與記錄同 org）
-- 2. restore_request()      — 加 org 驗證
-- 3. hard_delete_expense_request() — 清 storage 附件再刪 row
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. soft_delete_request — 加 org 驗證 ────────────────────────────────
--
-- 驗證邏輯：
--   a. 從 auth.uid() → employees 查出 caller 的 organization_id
--   b. 有 organization_id 欄位的表：直接比對
--   c. 無 organization_id 的表（leave/overtime/clock）：比對 employee 所在 org
--   d. super_admin（organization_id IS NULL）跳過 org 檢查

CREATE OR REPLACE FUNCTION public.soft_delete_request(
  p_table      TEXT,
  p_id         INT,
  p_deleted_by INT DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller_org INT;
  v_record_org INT;
  v_emp_id     INT;
BEGIN
  -- 查 caller org（super_admin 的 organization_id 可能是 NULL）
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
          RAISE EXCEPTION 'soft_delete_request: permission denied (org mismatch)';
        END IF;
      END IF;
      UPDATE public.leave_requests
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'overtime_requests' THEN
      SELECT employee_id INTO v_emp_id FROM public.overtime_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL THEN
        SELECT organization_id INTO v_record_org FROM public.employees WHERE id = v_emp_id;
        IF v_record_org IS DISTINCT FROM v_caller_org THEN
          RAISE EXCEPTION 'soft_delete_request: permission denied (org mismatch)';
        END IF;
      END IF;
      UPDATE public.overtime_requests
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'clock_corrections' THEN
      SELECT employee_id INTO v_emp_id FROM public.clock_corrections WHERE id = p_id;
      IF v_caller_org IS NOT NULL THEN
        SELECT organization_id INTO v_record_org FROM public.employees WHERE id = v_emp_id;
        IF v_record_org IS DISTINCT FROM v_caller_org THEN
          RAISE EXCEPTION 'soft_delete_request: permission denied (org mismatch)';
        END IF;
      END IF;
      UPDATE public.clock_corrections
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'business_trips' THEN
      SELECT organization_id INTO v_record_org FROM public.business_trips WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'soft_delete_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.business_trips
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'headcount_requests' THEN
      SELECT organization_id INTO v_record_org FROM public.headcount_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'soft_delete_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.headcount_requests
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'expense_requests' THEN
      SELECT organization_id INTO v_record_org FROM public.expense_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'soft_delete_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.expense_requests
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'form_submissions' THEN
      SELECT organization_id INTO v_record_org FROM public.form_submissions WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'soft_delete_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.form_submissions
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'shift_swaps' THEN
      SELECT organization_id INTO v_record_org FROM public.shift_swaps WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'soft_delete_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.shift_swaps
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    WHEN 'off_requests' THEN
      SELECT organization_id INTO v_record_org FROM public.off_requests WHERE id = p_id;
      IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'soft_delete_request: permission denied (org mismatch)';
      END IF;
      UPDATE public.off_requests
      SET deleted_at = NOW(), deleted_by = p_deleted_by
      WHERE id = p_id AND deleted_at IS NULL;

    ELSE
      RAISE EXCEPTION 'soft_delete_request: unknown table %', p_table;
  END CASE;
END;
$$;


-- ─── 2. restore_request — 加 org 驗證 ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.restore_request(
  p_table TEXT,
  p_id    INT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller_org INT;
  v_record_org INT;
  v_emp_id     INT;
BEGIN
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


-- ─── 3. hard_delete_expense_request() — 清附件記錄再刪 row ───────────────
-- Storage 實體檔案需前端呼叫 supabase.storage.remove() 清除，
-- 此 RPC 先傳回 storage_path 清單，前端清完後再刪 row。
-- 前端流程：
--   1. const paths = await rpc('hard_delete_expense_request', { p_id })
--   2. if (paths) await supabase.storage.from('attachments').remove(paths)

CREATE OR REPLACE FUNCTION public.hard_delete_expense_request(
  p_id INT
) RETURNS TEXT[] LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller_org INT;
  v_record_org INT;
  v_paths      TEXT[];
BEGIN
  SELECT organization_id INTO v_caller_org
  FROM public.employees
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  SELECT organization_id INTO v_record_org
  FROM public.expense_requests WHERE id = p_id;

  IF v_caller_org IS NOT NULL AND v_record_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'hard_delete_expense_request: permission denied';
  END IF;

  -- 收集 storage paths
  SELECT ARRAY_AGG(storage_path) INTO v_paths
  FROM public.expense_request_attachments
  WHERE request_id = p_id AND storage_path IS NOT NULL;

  -- 刪附件記錄
  DELETE FROM public.expense_request_attachments WHERE request_id = p_id;

  -- 刪主記錄
  DELETE FROM public.expense_requests WHERE id = p_id;

  RETURN COALESCE(v_paths, ARRAY[]::TEXT[]);
END;
$$;

COMMENT ON FUNCTION public.hard_delete_expense_request IS
  '永久刪除費用申請：傳回 storage_path 陣列供前端清 Storage，再刪 DB row。';


COMMIT;

NOTIFY pgrst, 'reload schema';
