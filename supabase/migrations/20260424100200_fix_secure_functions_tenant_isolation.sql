-- ============================================================
-- MED-3: Replace app.tenant_id with current_employee_org()
--
-- The 14 secure_* SECURITY DEFINER functions previously read
-- the tenant ID from a session variable (app.tenant_id) that
-- the caller could potentially SET before invoking the RPC.
-- Replace with current_employee_org() which derives the org
-- from the authenticated JWT — cannot be spoofed by the client.
--
-- Also adds SET search_path = public, pg_temp to all functions
-- to prevent search-path injection.
-- ============================================================

BEGIN;

-- ─── 1. 薪資建立/更新 ───────────────────────────────────────
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
  v_tid INT;
  v_net INT;
  v_result salary_records;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  v_net := COALESCE(p_net_salary, p_base_salary + p_allowance + p_overtime - p_deductions - p_insurance);

  IF p_base_salary < 0 THEN RAISE EXCEPTION '底薪不可為負'; END IF;
  IF v_net < 0 THEN RAISE EXCEPTION '淨額不可為負：%', v_net; END IF;
  IF p_employee IS NULL OR p_employee = '' THEN RAISE EXCEPTION '員工欄位不可為空'; END IF;
  IF p_month IS NULL OR p_month = '' THEN RAISE EXCEPTION '月份欄位不可為空'; END IF;

  IF NOT EXISTS (SELECT 1 FROM employees WHERE name = p_employee AND organization_id = v_tid) THEN
    RAISE EXCEPTION '員工不存在或不屬於此租戶：%', p_employee;
  END IF;

  INSERT INTO salary_records (organization_id, employee, month, base_salary, allowance, overtime, deductions, insurance, net_salary)
  VALUES (v_tid, p_employee, p_month, p_base_salary, p_allowance, p_overtime, p_deductions, p_insurance, v_net)
  ON CONFLICT (id) DO UPDATE SET
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

-- ─── 2. 薪資更新（by id） ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_update_salary(
  p_id   INT,
  p_data JSONB
) RETURNS salary_records
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid INT;
  v_result salary_records;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF NOT EXISTS (SELECT 1 FROM salary_records WHERE id = p_id AND organization_id = v_tid) THEN
    RAISE EXCEPTION '薪資紀錄不存在或無權限：%', p_id;
  END IF;

  UPDATE salary_records
  SET
    base_salary = COALESCE((p_data->>'base_salary')::INT, base_salary),
    allowance   = COALESCE((p_data->>'allowance')::INT,   allowance),
    overtime    = COALESCE((p_data->>'overtime')::INT,    overtime),
    deductions  = COALESCE((p_data->>'deductions')::INT,  deductions),
    insurance   = COALESCE((p_data->>'insurance')::INT,   insurance),
    net_salary  = COALESCE((p_data->>'net_salary')::INT,  net_salary)
  WHERE id = p_id AND organization_id = v_tid
  RETURNING * INTO v_result;

  IF v_result.net_salary < 0 THEN
    RAISE EXCEPTION '淨額不可為負：%', v_result.net_salary;
  END IF;

  RETURN v_result;
END;
$$;

-- ─── 3. 會計分錄（含明細，原子操作） ──────────────────────────
CREATE OR REPLACE FUNCTION public.secure_create_journal_entry(
  p_entry_date  DATE,
  p_description TEXT,
  p_lines       JSONB,
  p_source      TEXT DEFAULT NULL,
  p_source_id   INT  DEFAULT NULL,
  p_created_by  TEXT DEFAULT NULL
) RETURNS journal_entries
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid          INT;
  v_entry        journal_entries;
  v_total_debit  NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line         JSONB;
  v_idx          INT := 0;
  v_entry_number TEXT;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION '分錄至少需要兩筆明細（一借一貸）';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_idx := v_idx + 1;
    IF v_line->>'account_code' IS NULL OR v_line->>'account_code' = '' THEN
      RAISE EXCEPTION '第 % 筆缺少科目代碼', v_idx;
    END IF;
    IF COALESCE((v_line->>'debit')::NUMERIC,  0) < 0 THEN RAISE EXCEPTION '第 % 筆借方不可為負', v_idx; END IF;
    IF COALESCE((v_line->>'credit')::NUMERIC, 0) < 0 THEN RAISE EXCEPTION '第 % 筆貸方不可為負', v_idx; END IF;
    IF COALESCE((v_line->>'debit')::NUMERIC,  0) > 0
   AND COALESCE((v_line->>'credit')::NUMERIC, 0) > 0 THEN
      RAISE EXCEPTION '第 % 筆不可同時有借貸金額', v_idx;
    END IF;
    v_total_debit  := v_total_debit  + COALESCE((v_line->>'debit')::NUMERIC,  0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION '借貸不平衡：借方 %, 貸方 %, 差額 %',
      v_total_debit, v_total_credit, ABS(v_total_debit - v_total_credit);
  END IF;

  v_entry_number := 'JE-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('journal_entries_id_seq')::TEXT, 6, '0');

  INSERT INTO journal_entries (organization_id, entry_number, entry_date, description, source, source_id, created_by, status)
  VALUES (v_tid, v_entry_number, p_entry_date, p_description, p_source, p_source_id, p_created_by, '草稿')
  RETURNING * INTO v_entry;

  INSERT INTO journal_lines (organization_id, entry_id, account_code, account_name, debit, credit, memo, cost_center)
  SELECT
    v_tid,
    v_entry.id,
    elem->>'account_code',
    elem->>'account_name',
    COALESCE((elem->>'debit')::NUMERIC,  0),
    COALESCE((elem->>'credit')::NUMERIC, 0),
    elem->>'memo',
    elem->>'cost_center'
  FROM jsonb_array_elements(p_lines) AS elem;

  RETURN v_entry;
END;
$$;

-- ─── 4. 單筆會計明細建立 ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_create_journal_line(
  p_entry_id     INT,
  p_account_code TEXT,
  p_account_name TEXT,
  p_debit        NUMERIC DEFAULT 0,
  p_credit       NUMERIC DEFAULT 0,
  p_memo         TEXT DEFAULT NULL,
  p_cost_center  TEXT DEFAULT NULL
) RETURNS journal_lines
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid INT;
  v_result journal_lines;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = p_entry_id AND organization_id = v_tid) THEN
    RAISE EXCEPTION '分錄不存在或無權限：%', p_entry_id;
  END IF;
  IF p_debit  < 0 THEN RAISE EXCEPTION '借方不可為負'; END IF;
  IF p_credit < 0 THEN RAISE EXCEPTION '貸方不可為負'; END IF;
  IF p_debit > 0 AND p_credit > 0 THEN RAISE EXCEPTION '不可同時有借貸金額'; END IF;

  INSERT INTO journal_lines (organization_id, entry_id, account_code, account_name, debit, credit, memo, cost_center)
  VALUES (v_tid, p_entry_id, p_account_code, p_account_name, p_debit, p_credit, p_memo, p_cost_center)
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 5. 批次建立會計明細 ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_batch_create_journal_lines(
  p_lines JSONB
) RETURNS SETOF journal_lines
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid INT;
  v_line JSONB;
  v_idx  INT := 0;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '明細不可為空';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_idx := v_idx + 1;
    IF COALESCE((v_line->>'debit')::NUMERIC,  0) < 0 THEN RAISE EXCEPTION '第 % 筆借方不可為負', v_idx; END IF;
    IF COALESCE((v_line->>'credit')::NUMERIC, 0) < 0 THEN RAISE EXCEPTION '第 % 筆貸方不可為負', v_idx; END IF;
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

-- ─── 6. 更新會計分錄 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_update_journal_entry(
  p_id   INT,
  p_data JSONB
) RETURNS journal_entries
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid INT;
  v_result journal_entries;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = p_id AND organization_id = v_tid) THEN
    RAISE EXCEPTION '分錄不存在或無權限：%', p_id;
  END IF;

  UPDATE journal_entries
  SET
    description = COALESCE(p_data->>'description', description),
    status      = COALESCE(p_data->>'status',      status),
    entry_date  = COALESCE((p_data->>'entry_date')::DATE, entry_date)
  WHERE id = p_id AND organization_id = v_tid
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 7. 批次匯入會計分錄 ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_bulk_insert_journal_entries(
  p_rows JSONB
) RETURNS SETOF journal_entries
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid INT;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION '分錄資料不可為空';
  END IF;

  RETURN QUERY
  INSERT INTO journal_entries (organization_id, entry_number, entry_date, description, source, source_id, created_by, status)
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

-- ─── 8. 審批狀態更新 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_update_approval(
  p_id            INT,
  p_status        TEXT,
  p_approver      TEXT,
  p_comments      TEXT DEFAULT NULL,
  p_reject_reason TEXT DEFAULT NULL
) RETURNS approval_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid     INT;
  v_current approval_requests;
  v_result  approval_requests;
  v_valid_statuses TEXT[] := ARRAY['待審核', '已核准', '已駁回', '已取消'];
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  SELECT * INTO v_current FROM approval_requests WHERE id = p_id AND organization_id = v_tid;
  IF NOT FOUND THEN RAISE EXCEPTION '審批單不存在或無權限：%', p_id; END IF;

  IF NOT (p_status = ANY(v_valid_statuses)) THEN RAISE EXCEPTION '無效狀態：%', p_status; END IF;
  IF v_current.status <> '待審核' THEN
    RAISE EXCEPTION '此審批單已為「%」狀態，不可再變更', v_current.status;
  END IF;
  IF p_status = '已駁回' AND (p_reject_reason IS NULL OR p_reject_reason = '') THEN
    RAISE EXCEPTION '駁回時必須填寫原因';
  END IF;
  IF p_approver IS NULL OR p_approver = '' THEN RAISE EXCEPTION '審批人不可為空'; END IF;

  UPDATE approval_requests
  SET status = p_status, approver = p_approver, comments = p_comments, decided_at = now()
  WHERE id = p_id AND organization_id = v_tid
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 9. 建立審批申請 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_create_approval_request(
  p_module        TEXT,
  p_document_type TEXT,
  p_document_id   INT,
  p_requester     TEXT,
  p_rule_id       INT DEFAULT NULL
) RETURNS approval_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid INT;
  v_result approval_requests;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_module IS NULL OR p_module = '' THEN RAISE EXCEPTION '模組不可為空'; END IF;
  IF p_document_type IS NULL OR p_document_type = '' THEN RAISE EXCEPTION '文件類型不可為空'; END IF;
  IF p_requester IS NULL OR p_requester = '' THEN RAISE EXCEPTION '申請人不可為空'; END IF;

  INSERT INTO approval_requests (organization_id, rule_id, module, document_type, document_id, requester, status)
  VALUES (v_tid, p_rule_id, p_module, p_document_type, p_document_id, p_requester, '待審核')
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 10. POS 交易建立 ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_create_pos_transaction(
  p_store           TEXT,
  p_cashier         TEXT,
  p_items           JSONB,
  p_subtotal        NUMERIC,
  p_discount        NUMERIC DEFAULT 0,
  p_tax             NUMERIC DEFAULT 0,
  p_total           NUMERIC DEFAULT NULL,
  p_payment_method  TEXT DEFAULT '現金',
  p_payment_ref     TEXT DEFAULT NULL,
  p_member_id       TEXT DEFAULT NULL,
  p_points_earned   INT  DEFAULT 0,
  p_points_used     INT  DEFAULT 0,
  p_invoice_number  TEXT DEFAULT NULL,
  p_invoice_carrier TEXT DEFAULT NULL
) RETURNS pos_transactions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid        INT;
  v_total      NUMERIC;
  v_txn_number TEXT;
  v_result     pos_transactions;
  v_valid_payments TEXT[] := ARRAY['現金', '信用卡', 'LINE Pay', '悠遊卡', '街口支付', '轉帳', '其他'];
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  v_total := COALESCE(p_total, p_subtotal - p_discount + p_tax);
  IF p_subtotal  < 0 THEN RAISE EXCEPTION '小計不可為負'; END IF;
  IF v_total     < 0 THEN RAISE EXCEPTION '總額不可為負'; END IF;
  IF p_discount  < 0 THEN RAISE EXCEPTION '折扣不可為負'; END IF;
  IF p_tax       < 0 THEN RAISE EXCEPTION '稅額不可為負'; END IF;

  IF NOT (p_payment_method = ANY(v_valid_payments)) THEN
    RAISE EXCEPTION '無效的付款方式：%', p_payment_method;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '交易必須包含至少一項商品';
  END IF;

  v_txn_number := 'POS-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || lpad((random() * 9999)::INT::TEXT, 4, '0');

  INSERT INTO pos_transactions (
    organization_id, transaction_number, store, cashier, items,
    subtotal, discount, tax, total,
    payment_method, payment_ref, member_id,
    points_earned, points_used,
    invoice_number, invoice_carrier, status
  ) VALUES (
    v_tid, v_txn_number, p_store, p_cashier, p_items,
    p_subtotal, p_discount, p_tax, v_total,
    p_payment_method, p_payment_ref, p_member_id,
    p_points_earned, p_points_used,
    p_invoice_number, p_invoice_carrier, '完成'
  ) RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 11. 假單審核 ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_update_leave_status(
  p_id            INT,
  p_status        TEXT,
  p_approver      TEXT,
  p_reject_reason TEXT DEFAULT NULL
) RETURNS leave_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid     INT;
  v_current leave_requests;
  v_result  leave_requests;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  SELECT * INTO v_current FROM leave_requests WHERE id = p_id AND organization_id = v_tid;
  IF NOT FOUND THEN RAISE EXCEPTION '假單不存在或無權限：%', p_id; END IF;

  IF v_current.status <> '待審核' THEN
    RAISE EXCEPTION '此假單已為「%」狀態，不可再變更', v_current.status;
  END IF;
  IF p_status NOT IN ('已核准', '已駁回') THEN
    RAISE EXCEPTION '狀態只可為「已核准」或「已駁回」';
  END IF;
  IF p_status = '已駁回' AND (p_reject_reason IS NULL OR p_reject_reason = '') THEN
    RAISE EXCEPTION '駁回時必須填寫原因';
  END IF;
  IF p_approver IS NULL OR p_approver = '' THEN RAISE EXCEPTION '審核人不可為空'; END IF;

  UPDATE leave_requests
  SET status = p_status, approver = p_approver, reject_reason = p_reject_reason
  WHERE id = p_id AND organization_id = v_tid
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 12. 加班單審核 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_update_overtime_status(
  p_id            INT,
  p_status        TEXT,
  p_reject_reason TEXT DEFAULT NULL
) RETURNS overtime_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid     INT;
  v_current overtime_requests;
  v_result  overtime_requests;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  SELECT * INTO v_current FROM overtime_requests WHERE id = p_id AND organization_id = v_tid;
  IF NOT FOUND THEN RAISE EXCEPTION '加班單不存在或無權限：%', p_id; END IF;

  IF v_current.status <> '待審核' THEN
    RAISE EXCEPTION '此加班單已為「%」狀態，不可再變更', v_current.status;
  END IF;
  IF p_status NOT IN ('已核准', '已駁回') THEN
    RAISE EXCEPTION '狀態只可為「已核准」或「已駁回」';
  END IF;
  IF p_status = '已駁回' AND (p_reject_reason IS NULL OR p_reject_reason = '') THEN
    RAISE EXCEPTION '駁回時必須填寫原因';
  END IF;

  UPDATE overtime_requests
  SET status = p_status, reject_reason = p_reject_reason
  WHERE id = p_id AND organization_id = v_tid
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 13. 採購單建立 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_create_purchase_order(
  p_po_number     TEXT,
  p_supplier      TEXT,
  p_items         JSONB,
  p_total_amount  NUMERIC,
  p_tax           NUMERIC DEFAULT 0,
  p_shipping      NUMERIC DEFAULT 0,
  p_payment_terms TEXT DEFAULT NULL,
  p_expected_date DATE DEFAULT NULL,
  p_pr_id         INT  DEFAULT NULL
) RETURNS purchase_orders
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid INT;
  v_result purchase_orders;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_supplier IS NULL OR p_supplier = '' THEN RAISE EXCEPTION '供應商不可為空'; END IF;
  IF p_total_amount < 0 THEN RAISE EXCEPTION '採購金額不可為負'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '採購單必須包含至少一項品項';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE name = p_supplier AND organization_id = v_tid) THEN
    RAISE EXCEPTION '供應商不存在或不屬於此租戶：%', p_supplier;
  END IF;

  INSERT INTO purchase_orders (
    organization_id, po_number, supplier, pr_id, items,
    total_amount, tax, shipping, payment_terms, expected_date, status
  ) VALUES (
    v_tid, p_po_number, p_supplier, p_pr_id, p_items,
    p_total_amount, p_tax, p_shipping, p_payment_terms, p_expected_date, '待確認'
  ) RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── 14. 銷售單建立 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.secure_create_sales_order(
  p_order_number TEXT,
  p_customer     TEXT,
  p_items        JSONB,
  p_subtotal     NUMERIC,
  p_discount     NUMERIC DEFAULT 0,
  p_tax          NUMERIC DEFAULT 0,
  p_total        NUMERIC DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL,
  p_created_by   TEXT DEFAULT NULL,
  p_quote_id     INT  DEFAULT NULL
) RETURNS sales_orders
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid   INT;
  v_total NUMERIC;
  v_result sales_orders;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  v_total := COALESCE(p_total, p_subtotal - p_discount + p_tax);

  IF p_customer IS NULL OR p_customer = '' THEN RAISE EXCEPTION '客戶不可為空'; END IF;
  IF v_total    < 0 THEN RAISE EXCEPTION '銷售總額不可為負'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '銷售單必須包含至少一項品項';
  END IF;

  INSERT INTO sales_orders (
    organization_id, order_number, quote_id, customer, items,
    subtotal, discount, tax, total,
    notes, created_by, payment_status, shipping_status, credit_check
  ) VALUES (
    v_tid, p_order_number, p_quote_id, p_customer, p_items,
    p_subtotal, p_discount, p_tax, v_total,
    p_notes, p_created_by, '未付款', '未出貨', '通過'
  ) RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── Grants ─────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.secure_upsert_salary(TEXT,TEXT,INT,INT,INT,INT,INT,INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_update_salary(INT,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_create_journal_entry(DATE,TEXT,JSONB,TEXT,INT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_create_journal_line(INT,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_batch_create_journal_lines(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_update_journal_entry(INT,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_bulk_insert_journal_entries(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_update_approval(INT,TEXT,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_create_approval_request(TEXT,TEXT,INT,TEXT,INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_create_pos_transaction(TEXT,TEXT,JSONB,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,INT,INT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_update_leave_status(INT,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_update_overtime_status(INT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_create_purchase_order(TEXT,TEXT,JSONB,NUMERIC,NUMERIC,NUMERIC,TEXT,DATE,INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.secure_create_sales_order(TEXT,TEXT,JSONB,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,INT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.secure_upsert_salary(TEXT,TEXT,INT,INT,INT,INT,INT,INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.secure_update_salary(INT,JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.secure_create_journal_entry(DATE,TEXT,JSONB,TEXT,INT,TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.secure_create_journal_line(INT,TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.secure_batch_create_journal_lines(JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.secure_update_journal_entry(INT,JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.secure_bulk_insert_journal_entries(JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.secure_update_approval(INT,TEXT,TEXT,TEXT,TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.secure_create_approval_request(TEXT,TEXT,INT,TEXT,INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.secure_create_pos_transaction(TEXT,TEXT,JSONB,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,INT,INT,TEXT,TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.secure_update_leave_status(INT,TEXT,TEXT,TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.secure_update_overtime_status(INT,TEXT,TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.secure_create_purchase_order(TEXT,TEXT,JSONB,NUMERIC,NUMERIC,NUMERIC,TEXT,DATE,INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.secure_create_sales_order(TEXT,TEXT,JSONB,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT,TEXT,INT) FROM anon;

COMMIT;
