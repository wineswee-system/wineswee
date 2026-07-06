-- ============================================================
-- 20260705161000_vat_documents.sql
-- F-B3 401/403 正規化 — 正式進銷項憑證檔（PLAN_fin-tax-inv_2026-07-04 二/F-B3）
--
-- 1. vat_input_documents（進項）/ vat_output_documents（銷項）
--    401 申報與媒體檔的正式資料來源（取代現行從 AR/AP 湊數）。
--    冪等鍵：UNIQUE(organization_id, source_type, source_id)。
-- 2. secure_ingest_vat_document(p_direction, p_payload) — SECURITY DEFINER 冪等 upsert
--    （事件 handler finance.invoice.issued/voided/allowance → 自動彙入）
-- 3. backfill_vat_output_from_pos_invoices(p_period) — 由 pos_invoices 一鍵補入銷項憑證
--
--    pos_invoices → vat_output_documents 對映表：
--    ┌─────────────────────┬──────────┬───────────────────────┬─────────────────────────────┐
--    │ pos_invoices.status │ 格式代號 │ source_type            │ 金額                         │
--    ├─────────────────────┼──────────┼───────────────────────┼─────────────────────────────┤
--    │ issued（無統編）    │ 35       │ pos_invoice            │ +sales_amount / +tax_amount │
--    │ issued（有統編）    │ 31       │ pos_invoice            │ +sales_amount / +tax_amount │
--    │ voided              │ —        │ （排除；既有列刪除）    │ —                           │
--    │ allowance           │ 35/31    │ pos_invoice（原開立）   │ +sales_amount / +tax_amount │
--    │   └ 折讓證明單       │ 33       │ pos_invoice_allowance  │ −sales_amount / −tax_amount │
--    └─────────────────────┴──────────┴───────────────────────┴─────────────────────────────┘
--    註：pos_invoices.status='allowance' 為跨日全額折讓（void-invoice edge function），
--        原發票仍有效 → 保留原銷項憑證（35/31）+ 另立一筆負額折讓（33），淨額歸零。
--
-- 冪等：可重複執行。
-- ============================================================

-- ═══ 1. 進項 / 銷項憑證表 ═══

CREATE TABLE IF NOT EXISTS public.vat_input_documents (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period          INT           NOT NULL CHECK (period % 100 IN (1, 3, 5, 7, 9, 11)),  -- YYYYMM 奇數月
  format_code     TEXT          NOT NULL,  -- 進項格式代號 21-29（21 三聯式、25 進項折讓…）
  doc_number      TEXT          NOT NULL,  -- 憑證號碼（字軌 2 碼 + 流水 8 碼）
  doc_date        DATE          NOT NULL,
  counterparty_ubn TEXT,                   -- 賣方統一編號
  amount          NUMERIC(14,2) NOT NULL DEFAULT 0,  -- 未稅金額（折讓為負）
  tax_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_type        TEXT          NOT NULL DEFAULT '應稅' CHECK (tax_type IN ('應稅', '零稅率', '免稅')),
  deduction_code  TEXT          NOT NULL DEFAULT '可扣抵' CHECK (deduction_code IN ('可扣抵', '不可扣抵')),
  source_type     TEXT          NOT NULL,
  source_id       TEXT          NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, source_type, source_id)   -- 冪等鍵
);

CREATE TABLE IF NOT EXISTS public.vat_output_documents (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period          INT           NOT NULL CHECK (period % 100 IN (1, 3, 5, 7, 9, 11)),
  format_code     TEXT          NOT NULL,  -- 銷項格式代號 31-38（35 二聯/電子、31 三聯、33 銷項折讓…）
  doc_number      TEXT          NOT NULL,
  doc_date        DATE          NOT NULL,
  counterparty_ubn TEXT,                   -- 買受人統一編號（B2C 為 NULL）
  amount          NUMERIC(14,2) NOT NULL DEFAULT 0,  -- 未稅金額（折讓為負）
  tax_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_type        TEXT          NOT NULL DEFAULT '應稅' CHECK (tax_type IN ('應稅', '零稅率', '免稅')),
  deduction_code  TEXT          CHECK (deduction_code IN ('可扣抵', '不可扣抵')),  -- 銷項不適用，保留欄位對稱
  source_type     TEXT          NOT NULL,
  source_id       TEXT          NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, source_type, source_id)   -- 冪等鍵
);

CREATE INDEX IF NOT EXISTS vat_input_documents_org_period_idx
  ON public.vat_input_documents (organization_id, period);
CREATE INDEX IF NOT EXISTS vat_output_documents_org_period_idx
  ON public.vat_output_documents (organization_id, period);

COMMENT ON TABLE public.vat_input_documents  IS '進項憑證檔（F-B3）：401 申報/媒體檔正式資料來源';
COMMENT ON TABLE public.vat_output_documents IS '銷項憑證檔（F-B3）：401 申報/媒體檔正式資料來源；折讓（格式 33）金額為負';

-- ═══ 2. secure_ingest_vat_document：冪等 upsert（事件驅動彙入）═══
-- p_direction：'input' | 'output'
-- p_payload：{ source_type*, source_id*, format_code, doc_number, doc_date,
--              counterparty_ubn, amount, tax_amount, tax_type, deduction_code,
--              period（省略時由 doc_date 推奇數月期別）, organization_id（僅 service role）,
--              _action: 'upsert'（預設）| 'remove'（發票作廢 → 刪除既有憑證列）}

CREATE OR REPLACE FUNCTION public.secure_ingest_vat_document(
  p_direction TEXT,
  p_payload   JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org       BIGINT;
  v_action    TEXT;
  v_src_type  TEXT;
  v_src_id    TEXT;
  v_date      DATE;
  v_month     INT;
  v_period    INT;
  v_removed   INT;
  v_row_id    UUID;
BEGIN
  IF p_direction NOT IN ('input', 'output') THEN
    RAISE EXCEPTION 'p_direction 必須為 input 或 output';
  END IF;

  -- 租戶識別：登入使用者取自 employees；service role 可由 payload 指定
  v_org := current_employee_org();
  IF v_org IS NULL AND auth.role() = 'service_role' THEN
    v_org := (p_payload->>'organization_id')::BIGINT;
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION '無法識別租戶：請確認登入狀態';
  END IF;

  v_src_type := p_payload->>'source_type';
  v_src_id   := p_payload->>'source_id';
  IF COALESCE(v_src_type, '') = '' OR COALESCE(v_src_id, '') = '' THEN
    RAISE EXCEPTION '缺少來源單據識別（source_type / source_id）';
  END IF;

  v_action := COALESCE(p_payload->>'_action', 'upsert');

  -- 移除（發票作廢 → 憑證檔不計入）
  IF v_action = 'remove' THEN
    IF p_direction = 'input' THEN
      DELETE FROM vat_input_documents
       WHERE organization_id = v_org AND source_type = v_src_type AND source_id = v_src_id;
    ELSE
      DELETE FROM vat_output_documents
       WHERE organization_id = v_org AND source_type = v_src_type AND source_id = v_src_id;
    END IF;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    RETURN jsonb_build_object('action', 'remove', 'removed', v_removed);
  END IF;

  v_date := COALESCE(NULLIF(p_payload->>'doc_date', '')::DATE, CURRENT_DATE);

  -- 期別：payload 指定優先，否則由 doc_date 推奇數月 YYYYMM（雙月一期）
  IF COALESCE(p_payload->>'period', '') <> '' THEN
    v_period := (p_payload->>'period')::INT;
  ELSE
    v_month  := EXTRACT(MONTH FROM v_date)::INT;
    v_month  := v_month - ((v_month + 1) % 2);  -- 8→7、7→7
    v_period := EXTRACT(YEAR FROM v_date)::INT * 100 + v_month;
  END IF;

  IF p_direction = 'input' THEN
    INSERT INTO vat_input_documents
      (organization_id, period, format_code, doc_number, doc_date, counterparty_ubn,
       amount, tax_amount, tax_type, deduction_code, source_type, source_id)
    VALUES
      (v_org, v_period,
       COALESCE(NULLIF(p_payload->>'format_code', ''), '21'),
       COALESCE(p_payload->>'doc_number', ''),
       v_date,
       NULLIF(p_payload->>'counterparty_ubn', ''),
       COALESCE((p_payload->>'amount')::NUMERIC, 0),
       COALESCE((p_payload->>'tax_amount')::NUMERIC, 0),
       COALESCE(NULLIF(p_payload->>'tax_type', ''), '應稅'),
       COALESCE(NULLIF(p_payload->>'deduction_code', ''), '可扣抵'),
       v_src_type, v_src_id)
    ON CONFLICT (organization_id, source_type, source_id) DO UPDATE SET
      period = EXCLUDED.period, format_code = EXCLUDED.format_code,
      doc_number = EXCLUDED.doc_number, doc_date = EXCLUDED.doc_date,
      counterparty_ubn = EXCLUDED.counterparty_ubn, amount = EXCLUDED.amount,
      tax_amount = EXCLUDED.tax_amount, tax_type = EXCLUDED.tax_type,
      deduction_code = EXCLUDED.deduction_code
    RETURNING id INTO v_row_id;
  ELSE
    INSERT INTO vat_output_documents
      (organization_id, period, format_code, doc_number, doc_date, counterparty_ubn,
       amount, tax_amount, tax_type, source_type, source_id)
    VALUES
      (v_org, v_period,
       COALESCE(NULLIF(p_payload->>'format_code', ''), '35'),
       COALESCE(p_payload->>'doc_number', ''),
       v_date,
       NULLIF(p_payload->>'counterparty_ubn', ''),
       COALESCE((p_payload->>'amount')::NUMERIC, 0),
       COALESCE((p_payload->>'tax_amount')::NUMERIC, 0),
       COALESCE(NULLIF(p_payload->>'tax_type', ''), '應稅'),
       v_src_type, v_src_id)
    ON CONFLICT (organization_id, source_type, source_id) DO UPDATE SET
      period = EXCLUDED.period, format_code = EXCLUDED.format_code,
      doc_number = EXCLUDED.doc_number, doc_date = EXCLUDED.doc_date,
      counterparty_ubn = EXCLUDED.counterparty_ubn, amount = EXCLUDED.amount,
      tax_amount = EXCLUDED.tax_amount, tax_type = EXCLUDED.tax_type
    RETURNING id INTO v_row_id;
  END IF;

  RETURN jsonb_build_object('action', 'upsert', 'id', v_row_id, 'period', v_period);
END;
$$;

GRANT EXECUTE ON FUNCTION public.secure_ingest_vat_document(TEXT, JSONB) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.secure_ingest_vat_document(TEXT, JSONB) FROM anon;

-- ═══ 3. backfill_vat_output_from_pos_invoices：一鍵補入銷項憑證 ═══
-- 缺漏警示的「一鍵補入」：把該期別 pos_invoices 依上方對映表 upsert 進 vat_output_documents，
-- 已作廢的發票同步移除既有憑證列。冪等 — 重跑結果一致。

CREATE OR REPLACE FUNCTION public.backfill_vat_output_from_pos_invoices(p_period INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org        BIGINT;
  v_start      DATE;
  v_end        DATE;
  v_issued     INT := 0;
  v_allowances INT := 0;
  v_removed    INT := 0;
BEGIN
  v_org := current_employee_org();
  IF v_org IS NULL THEN
    RAISE EXCEPTION '無法識別租戶：請確認登入狀態';
  END IF;

  IF p_period IS NULL OR (p_period % 100) NOT IN (1, 3, 5, 7, 9, 11) THEN
    RAISE EXCEPTION '期別格式錯誤（應為 YYYYMM 且月份為奇數月，例 202607）';
  END IF;

  v_start := make_date(p_period / 100, p_period % 100, 1);
  v_end   := (v_start + INTERVAL '2 months' - INTERVAL '1 day')::DATE;

  -- issued / allowance → 原開立銷項憑證（有統編 31 / 無統編 35）
  INSERT INTO vat_output_documents
    (organization_id, period, format_code, doc_number, doc_date, counterparty_ubn,
     amount, tax_amount, tax_type, source_type, source_id)
  SELECT
    v_org, p_period,
    CASE WHEN COALESCE(pi.buyer_tax_id, '') <> '' THEN '31' ELSE '35' END,
    pi.invoice_number, pi.invoice_date, NULLIF(pi.buyer_tax_id, ''),
    COALESCE(pi.sales_amount, 0), COALESCE(pi.tax_amount, 0), '應稅',
    'pos_invoice', pi.id::TEXT
  FROM pos_invoices pi
  WHERE pi.organization_id = v_org
    AND pi.invoice_date BETWEEN v_start AND v_end
    AND pi.status IN ('issued', 'allowance')
  ON CONFLICT (organization_id, source_type, source_id) DO UPDATE SET
    period = EXCLUDED.period, format_code = EXCLUDED.format_code,
    doc_number = EXCLUDED.doc_number, doc_date = EXCLUDED.doc_date,
    counterparty_ubn = EXCLUDED.counterparty_ubn, amount = EXCLUDED.amount,
    tax_amount = EXCLUDED.tax_amount;
  GET DIAGNOSTICS v_issued = ROW_COUNT;

  -- allowance → 另立負額折讓證明單（格式 33，全額折讓，淨額歸零）
  INSERT INTO vat_output_documents
    (organization_id, period, format_code, doc_number, doc_date, counterparty_ubn,
     amount, tax_amount, tax_type, source_type, source_id)
  SELECT
    v_org, p_period, '33',
    pi.invoice_number, pi.invoice_date, NULLIF(pi.buyer_tax_id, ''),
    -COALESCE(pi.sales_amount, 0), -COALESCE(pi.tax_amount, 0), '應稅',
    'pos_invoice_allowance', pi.id::TEXT
  FROM pos_invoices pi
  WHERE pi.organization_id = v_org
    AND pi.invoice_date BETWEEN v_start AND v_end
    AND pi.status = 'allowance'
  ON CONFLICT (organization_id, source_type, source_id) DO UPDATE SET
    period = EXCLUDED.period, doc_number = EXCLUDED.doc_number,
    doc_date = EXCLUDED.doc_date, counterparty_ubn = EXCLUDED.counterparty_ubn,
    amount = EXCLUDED.amount, tax_amount = EXCLUDED.tax_amount;
  GET DIAGNOSTICS v_allowances = ROW_COUNT;

  -- voided → 排除（既有憑證列刪除；同日作廢的發票不計入申報）
  DELETE FROM vat_output_documents d
  USING pos_invoices pi
  WHERE d.organization_id = v_org
    AND pi.organization_id = v_org
    AND pi.status = 'voided'
    AND pi.invoice_date BETWEEN v_start AND v_end
    AND d.source_type IN ('pos_invoice', 'pos_invoice_allowance')
    AND d.source_id = pi.id::TEXT;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  RETURN jsonb_build_object(
    'period', p_period,
    'issued_upserted', v_issued,
    'allowances_upserted', v_allowances,
    'voided_removed', v_removed
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_vat_output_from_pos_invoices(INT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.backfill_vat_output_from_pos_invoices(INT) FROM anon;

-- ═══ 4. RLS：org 內僅可讀；寫入一律經 SECURITY DEFINER RPC ═══

ALTER TABLE public.vat_input_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vat_output_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vat_input_documents_sel ON public.vat_input_documents;
CREATE POLICY vat_input_documents_sel ON public.vat_input_documents
  FOR SELECT TO authenticated
  USING (org_visible(organization_id));

DROP POLICY IF EXISTS vat_output_documents_sel ON public.vat_output_documents;
CREATE POLICY vat_output_documents_sel ON public.vat_output_documents
  FOR SELECT TO authenticated
  USING (org_visible(organization_id));

NOTIFY pgrst, 'reload schema';
