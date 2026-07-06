-- ============================================================
-- 20260705120000_document_number_rules.sql
-- F-C3.1 單據編號規則表（PLAN_fin-tax-inv_2026-07-04 三/F-C3）
--
-- 1. document_number_rules     — 每組織 × 單據類型一條規則
--    （organization_id IS NULL = 全域預設規則，org 未自訂時 fallback）
-- 2. document_number_sequences — 流水號狀態（組織 × 單據類型 × 期別）
-- 3. allocate_document_number(p_doc_type, p_org) — 原子取號 RPC
--    row-lock（UPDATE ... RETURNING）保證併發不重號，
--    與 allocate_invoice_number（20260702610000）同一模式。
-- 4. 種子：10 種單據類型的全域預設規則
--
-- 冪等：可重複執行。
-- ============================================================

-- ═══ 1. 編號規則表 ═══

CREATE TABLE IF NOT EXISTS public.document_number_rules (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT      REFERENCES public.organizations(id) ON DELETE CASCADE,  -- NULL = 全域預設
  doc_type        TEXT        NOT NULL,
  prefix          TEXT        NOT NULL DEFAULT '',
  date_format     TEXT        NOT NULL DEFAULT 'YYYYMM'
                              CHECK (date_format IN ('YYYYMM', 'YYYYMMDD', '')),
  sequence_digits INT         NOT NULL DEFAULT 4
                              CHECK (sequence_digits BETWEEN 1 AND 10),
  reset_cycle     TEXT        NOT NULL DEFAULT 'month'
                              CHECK (reset_cycle IN ('year', 'month', 'none')),
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, doc_type)
);

-- UNIQUE 對 NULL 不生效 → 全域預設列（organization_id IS NULL）另用部分唯一索引鎖住
CREATE UNIQUE INDEX IF NOT EXISTS document_number_rules_global_uniq
  ON public.document_number_rules (doc_type)
  WHERE organization_id IS NULL;

COMMENT ON TABLE public.document_number_rules IS
  '單據編號規則（F-C3.1）：prefix + date_format 日期段 + sequence_digits 位流水號；reset_cycle 決定流水號重置週期';

-- ═══ 2. 流水號狀態表 ═══

CREATE TABLE IF NOT EXISTS public.document_number_sequences (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  doc_type        TEXT        NOT NULL,
  period_key      TEXT        NOT NULL DEFAULT '',  -- 'YYYY'（年重置）/ 'YYYYMM'（月重置）/ ''（不重置）
  next_number     BIGINT      NOT NULL DEFAULT 0,   -- 最後配出的流水號（取號時 +1 後回傳）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, doc_type, period_key)
);

-- ═══ 3. 原子取號 RPC ═══
-- 註：本專案 organizations.id 為 BIGSERIAL，故 p_org 用 BIGINT（同 allocate_invoice_number）。
-- 日期/期別以台北時區為準（單據日期慣例）。

CREATE OR REPLACE FUNCTION public.allocate_document_number(
  p_doc_type TEXT,
  p_org      BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule       public.document_number_rules%ROWTYPE;
  v_now        TIMESTAMP;
  v_period_key TEXT;
  v_date_part  TEXT;
  v_seq        BIGINT;
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION '取號失敗：p_org 不可為 NULL';
  END IF;

  -- 呼叫者必須屬於該組織（service role 豁免，供 edge function / 批次使用）
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND auth_org_id() IS DISTINCT FROM p_org::INT THEN
    RAISE EXCEPTION '取號失敗：無權為組織 % 取號', p_org;
  END IF;

  -- 規則：org 自訂優先，否則 fallback 全域預設（organization_id IS NULL）
  SELECT * INTO v_rule
    FROM public.document_number_rules
   WHERE doc_type = p_doc_type
     AND is_active
     AND (organization_id = p_org OR organization_id IS NULL)
   ORDER BY organization_id NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到單據類型 % 的啟用編號規則', p_doc_type;
  END IF;

  v_now := (NOW() AT TIME ZONE 'Asia/Taipei');

  v_period_key := CASE v_rule.reset_cycle
    WHEN 'year'  THEN to_char(v_now, 'YYYY')
    WHEN 'month' THEN to_char(v_now, 'YYYYMM')
    ELSE ''
  END;

  v_date_part := CASE v_rule.date_format
    WHEN 'YYYYMM'   THEN to_char(v_now, 'YYYYMM')
    WHEN 'YYYYMMDD' THEN to_char(v_now, 'YYYYMMDD')
    ELSE ''
  END;

  -- 首次使用該期別時建立流水號列（ON CONFLICT 冪等）
  INSERT INTO public.document_number_sequences (organization_id, doc_type, period_key)
  VALUES (p_org, p_doc_type, v_period_key)
  ON CONFLICT (organization_id, doc_type, period_key) DO NOTHING;

  -- row lock：併發取號時序列化，保證不重號
  UPDATE public.document_number_sequences
     SET next_number = next_number + 1,
         updated_at  = NOW()
   WHERE organization_id = p_org
     AND doc_type   = p_doc_type
     AND period_key = v_period_key
  RETURNING next_number INTO v_seq;

  -- 流水號超出位數時自動加寬（lpad 會截斷，故取 GREATEST）
  RETURN concat_ws('-',
    NULLIF(v_rule.prefix, ''),
    NULLIF(v_date_part, ''),
    lpad(v_seq::TEXT, GREATEST(v_rule.sequence_digits, length(v_seq::TEXT)), '0')
  );
END;
$$;

-- 取號供登入使用者（前端建單）與 service role（edge function/批次）使用
REVOKE ALL ON FUNCTION public.allocate_document_number(TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_document_number(TEXT, BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.allocate_document_number(TEXT, BIGINT) TO authenticated, service_role;

-- ═══ 4. 種子：全域預設規則（org 可自建同 doc_type 規則覆蓋）═══

INSERT INTO public.document_number_rules (organization_id, doc_type, prefix, date_format, sequence_digits, reset_cycle)
VALUES
  (NULL, 'quotation',          'QT', 'YYYYMM', 4, 'month'),  -- 報價單
  (NULL, 'sales_order',        'SO', 'YYYYMM', 4, 'month'),  -- 銷貨訂單
  (NULL, 'purchase_request',   'PR', 'YYYYMM', 4, 'month'),  -- 請購單
  (NULL, 'purchase_order',     'PO', 'YYYYMM', 4, 'month'),  -- 採購單
  (NULL, 'goods_receipt',      'GR', 'YYYYMM', 4, 'month'),  -- 進貨驗收單
  (NULL, 'sales_return',       'SR', 'YYYYMM', 4, 'month'),  -- 銷貨退回單
  (NULL, 'sales_allowance',    'SA', 'YYYYMM', 4, 'month'),  -- 銷貨折讓單
  (NULL, 'purchase_allowance', 'PA', 'YYYYMM', 4, 'month'),  -- 進貨折讓單
  (NULL, 'journal_entry',      'JE', 'YYYYMMDD', 4, 'month'),-- 會計傳票
  (NULL, 'stock_count',        'SC', 'YYYYMMDD', 3, 'month') -- 盤點單
ON CONFLICT (doc_type) WHERE organization_id IS NULL DO NOTHING;

-- ═══ 5. RLS ═══

ALTER TABLE public.document_number_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_number_sequences ENABLE ROW LEVEL SECURITY;

-- 規則：org 內可讀（含全域預設列）；寫入僅限自己 org 的自訂規則（全域列僅 service role 可動）
DROP POLICY IF EXISTS document_number_rules_org_sel ON public.document_number_rules;
CREATE POLICY document_number_rules_org_sel ON public.document_number_rules
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR org_visible(organization_id));

DROP POLICY IF EXISTS document_number_rules_org_ins ON public.document_number_rules;
CREATE POLICY document_number_rules_org_ins ON public.document_number_rules
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IS NOT NULL AND org_visible(organization_id));

DROP POLICY IF EXISTS document_number_rules_org_upd ON public.document_number_rules;
CREATE POLICY document_number_rules_org_upd ON public.document_number_rules
  FOR UPDATE TO authenticated
  USING (organization_id IS NOT NULL AND org_visible(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND org_visible(organization_id));

DROP POLICY IF EXISTS document_number_rules_org_del ON public.document_number_rules;
CREATE POLICY document_number_rules_org_del ON public.document_number_rules
  FOR DELETE TO authenticated
  USING (organization_id IS NOT NULL AND org_visible(organization_id));

-- 流水號：org 內僅可讀（餘量/狀態查詢）；寫入一律經 SECURITY DEFINER RPC
DROP POLICY IF EXISTS document_number_sequences_org_sel ON public.document_number_sequences;
CREATE POLICY document_number_sequences_org_sel ON public.document_number_sequences
  FOR SELECT TO authenticated
  USING (org_visible(organization_id));

NOTIFY pgrst, 'reload schema';
