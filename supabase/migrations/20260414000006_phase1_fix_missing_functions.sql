-- ============================================================
-- Phase 1 修補：REVOKE 後遺漏的寫入操作補建 Postgres Function
-- ============================================================

-- ─── 單筆會計明細建立 ───
CREATE OR REPLACE FUNCTION secure_create_journal_line(
  p_entry_id INT,
  p_account_code TEXT,
  p_account_name TEXT,
  p_debit NUMERIC DEFAULT 0,
  p_credit NUMERIC DEFAULT 0,
  p_memo TEXT DEFAULT NULL,
  p_cost_center TEXT DEFAULT NULL
) RETURNS journal_lines
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
  v_result journal_lines;
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  -- 驗證分錄主檔屬於此租戶
  IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = p_entry_id AND tenant_id = v_tid) THEN
    RAISE EXCEPTION '分錄不存在或無權限：%', p_entry_id;
  END IF;
  IF p_debit < 0 THEN RAISE EXCEPTION '借方不可為負'; END IF;
  IF p_credit < 0 THEN RAISE EXCEPTION '貸方不可為負'; END IF;
  IF p_debit > 0 AND p_credit > 0 THEN RAISE EXCEPTION '不可同時有借貸金額'; END IF;

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, memo, cost_center)
  VALUES (v_tid, p_entry_id, p_account_code, p_account_name, p_debit, p_credit, p_memo, p_cost_center)
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 批次建立會計明細 ───
CREATE OR REPLACE FUNCTION secure_batch_create_journal_lines(
  p_lines JSONB
) RETURNS SETOF journal_lines
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
  v_line JSONB;
  v_idx INT := 0;
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '明細不可為空';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_idx := v_idx + 1;
    IF COALESCE((v_line->>'debit')::NUMERIC, 0) < 0 THEN
      RAISE EXCEPTION '第 % 筆借方不可為負', v_idx;
    END IF;
    IF COALESCE((v_line->>'credit')::NUMERIC, 0) < 0 THEN
      RAISE EXCEPTION '第 % 筆貸方不可為負', v_idx;
    END IF;
  END LOOP;

  RETURN QUERY
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, memo, cost_center)
  SELECT
    v_tid,
    (elem->>'entry_id')::INT,
    elem->>'account_code',
    elem->>'account_name',
    COALESCE((elem->>'debit')::NUMERIC, 0),
    COALESCE((elem->>'credit')::NUMERIC, 0),
    elem->>'memo',
    elem->>'cost_center'
  FROM jsonb_array_elements(p_lines) AS elem
  RETURNING *;
END;
$$;

-- ─── 更新會計分錄（狀態/描述等） ───
CREATE OR REPLACE FUNCTION secure_update_journal_entry(
  p_id INT,
  p_data JSONB
) RETURNS journal_entries
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
  v_result journal_entries;
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = p_id AND tenant_id = v_tid) THEN
    RAISE EXCEPTION '分錄不存在或無權限：%', p_id;
  END IF;

  UPDATE journal_entries
  SET
    description = COALESCE(p_data->>'description', description),
    status = COALESCE(p_data->>'status', status),
    entry_date = COALESCE((p_data->>'entry_date')::DATE, entry_date)
  WHERE id = p_id AND tenant_id = v_tid
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 批次匯入會計分錄 ───
CREATE OR REPLACE FUNCTION secure_bulk_insert_journal_entries(
  p_rows JSONB
) RETURNS SETOF journal_entries
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION '分錄資料不可為空';
  END IF;

  RETURN QUERY
  INSERT INTO journal_entries (tenant_id, entry_number, entry_date, description, source, source_id, created_by, status)
  SELECT
    v_tid,
    elem->>'entry_number',
    (elem->>'entry_date')::DATE,
    elem->>'description',
    elem->>'source',
    (elem->>'source_id')::INT,
    elem->>'created_by',
    COALESCE(elem->>'status', '草稿')
  FROM jsonb_array_elements(p_rows) AS elem
  RETURNING *;
END;
$$;

-- ─── 更新薪資紀錄 ───
CREATE OR REPLACE FUNCTION secure_update_salary(
  p_id INT,
  p_data JSONB
) RETURNS salary_records
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
  v_result salary_records;
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  IF NOT EXISTS (SELECT 1 FROM salary_records WHERE id = p_id AND tenant_id = v_tid) THEN
    RAISE EXCEPTION '薪資紀錄不存在或無權限：%', p_id;
  END IF;

  UPDATE salary_records
  SET
    base_salary = COALESCE((p_data->>'base_salary')::INT, base_salary),
    allowance = COALESCE((p_data->>'allowance')::INT, allowance),
    overtime = COALESCE((p_data->>'overtime')::INT, overtime),
    deductions = COALESCE((p_data->>'deductions')::INT, deductions),
    insurance = COALESCE((p_data->>'insurance')::INT, insurance),
    net_salary = COALESCE((p_data->>'net_salary')::INT, net_salary)
  WHERE id = p_id AND tenant_id = v_tid
  RETURNING * INTO v_result;

  IF v_result.net_salary < 0 THEN
    RAISE EXCEPTION '淨額不可為負：%', v_result.net_salary;
  END IF;

  RETURN v_result;
END;
$$;

-- ─── 建立審批申請 ───
CREATE OR REPLACE FUNCTION secure_create_approval_request(
  p_module TEXT,
  p_document_type TEXT,
  p_document_id INT,
  p_requester TEXT,
  p_rule_id INT DEFAULT NULL
) RETURNS approval_requests
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tid INT;
  v_result approval_requests;
BEGIN
  v_tid := current_setting('app.tenant_id', true)::INT;
  IF v_tid IS NULL THEN RAISE EXCEPTION '未設定租戶'; END IF;

  IF p_module IS NULL OR p_module = '' THEN RAISE EXCEPTION '模組不可為空'; END IF;
  IF p_document_type IS NULL OR p_document_type = '' THEN RAISE EXCEPTION '文件類型不可為空'; END IF;
  IF p_requester IS NULL OR p_requester = '' THEN RAISE EXCEPTION '申請人不可為空'; END IF;

  INSERT INTO approval_requests (tenant_id, rule_id, module, document_type, document_id, requester, status)
  VALUES (v_tid, p_rule_id, p_module, p_document_type, p_document_id, p_requester, '待審核')
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;
