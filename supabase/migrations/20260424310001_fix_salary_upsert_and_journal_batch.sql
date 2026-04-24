-- ============================================================
-- Security patch: salary upsert + journal batch fixes
--
-- H-4: secure_upsert_salary used ON CONFLICT (id) on a serial PK —
--      the UPDATE branch was unreachable, creating duplicate salary rows
--      for the same employee-month on every call. Fixed with a unique
--      index and ON CONFLICT (organization_id, employee, month).
--
-- H-3: secure_batch_create_journal_lines accepted any entry_id without
--      verifying it belongs to the caller's org. Fixed by adding a
--      per-element org ownership check before the bulk INSERT.
-- ============================================================

BEGIN;

-- H-4: Unique index so ON CONFLICT target is valid (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_salary_records_org_emp_month
  ON public.salary_records (organization_id, employee, month);

-- H-4: Fix ON CONFLICT target from (id) → (organization_id, employee, month)
CREATE OR REPLACE FUNCTION public.secure_upsert_salary(
  p_employee    TEXT,
  p_month       TEXT,
  p_base_salary INT,
  p_allowance   INT DEFAULT 0,
  p_overtime    INT DEFAULT 0,
  p_deductions  INT DEFAULT 0,
  p_insurance   INT DEFAULT 0,
  p_net_salary  INT DEFAULT NULL
) RETURNS salary_records
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid    INT;
  v_net    INT;
  v_result salary_records;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  v_net := COALESCE(p_net_salary, p_base_salary + p_allowance + p_overtime - p_deductions - p_insurance);

  IF p_base_salary < 0 THEN RAISE EXCEPTION '底薪不可為負'; END IF;
  IF v_net < 0 THEN RAISE EXCEPTION '淨額不可為負：%', v_net; END IF;
  IF p_employee IS NULL OR p_employee = '' THEN RAISE EXCEPTION '員工欄位不可為空'; END IF;
  IF p_month    IS NULL OR p_month    = '' THEN RAISE EXCEPTION '月份欄位不可為空'; END IF;

  IF NOT EXISTS (SELECT 1 FROM employees WHERE name = p_employee AND organization_id = v_tid) THEN
    RAISE EXCEPTION '員工不存在或不屬於此租戶：%', p_employee;
  END IF;

  INSERT INTO salary_records (organization_id, employee, month, base_salary, allowance, overtime, deductions, insurance, net_salary)
  VALUES (v_tid, p_employee, p_month, p_base_salary, p_allowance, p_overtime, p_deductions, p_insurance, v_net)
  ON CONFLICT (organization_id, employee, month) DO UPDATE SET
    base_salary = EXCLUDED.base_salary,
    allowance   = EXCLUDED.allowance,
    overtime    = EXCLUDED.overtime,
    deductions  = EXCLUDED.deductions,
    insurance   = EXCLUDED.insurance,
    net_salary  = EXCLUDED.net_salary
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- H-3: Fix batch journal lines — verify each entry_id belongs to caller's org
--      before any INSERT (atomic: all-or-nothing)
CREATE OR REPLACE FUNCTION public.secure_batch_create_journal_lines(
  p_lines JSONB
) RETURNS SETOF journal_lines
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid      INT;
  v_line     JSONB;
  v_idx      INT := 0;
  v_entry_id INT;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '明細不可為空';
  END IF;

  -- Pre-validate all rows before inserting any (H-3)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_idx      := v_idx + 1;
    v_entry_id := (v_line->>'entry_id')::INT;

    IF COALESCE((v_line->>'debit')::NUMERIC,  0) < 0 THEN
      RAISE EXCEPTION '第 % 筆借方不可為負', v_idx;
    END IF;
    IF COALESCE((v_line->>'credit')::NUMERIC, 0) < 0 THEN
      RAISE EXCEPTION '第 % 筆貸方不可為負', v_idx;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM journal_entries WHERE id = v_entry_id AND organization_id = v_tid
    ) THEN
      RAISE EXCEPTION '第 % 筆分錄不存在或無權限：entry_id=%', v_idx, v_entry_id;
    END IF;
  END LOOP;

  RETURN QUERY
  INSERT INTO journal_lines (organization_id, entry_id, account_code, account_name, debit, credit, memo, cost_center)
  SELECT
    v_tid,
    (elem->>'entry_id')::INT,
    elem->>'account_code',
    elem->>'account_name',
    COALESCE((elem->>'debit')::NUMERIC,  0),
    COALESCE((elem->>'credit')::NUMERIC, 0),
    elem->>'memo',
    elem->>'cost_center'
  FROM jsonb_array_elements(p_lines) AS elem
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.secure_upsert_salary(TEXT,TEXT,INT,INT,INT,INT,INT,INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_upsert_salary(TEXT,TEXT,INT,INT,INT,INT,INT,INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.secure_batch_create_journal_lines(JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_batch_create_journal_lines(JSONB) FROM anon;

COMMIT;
