-- ════════════════════════════════════════════════════════════════════════════
-- F-A2 傳票自動拋轉引擎（單據→傳票）
-- 2026-07-05
--
-- 1. posting_rules：規則表（organization_id NULL = 全域預設模板，org 列可覆寫）
-- 2. journal_entries 補 source_type / source_ref（自動拋轉冪等鍵）
--    註：規劃書寫 source_id，但 journal_entries.source_id 既有且為 INT（legacy
--    路徑在用），文件來源 id 可能是 UUID/text → 另開 source_ref TEXT，不動舊欄。
-- 3. 全域預設模板種子（10 種單據類型）
-- 4. RPC secure_auto_post_voucher：解析規則 → server-side 求值金額運算式 →
--    驗證借貸平衡 → 原子寫入傳票+明細；同來源重複呼叫回傳既有傳票（冪等）。
--    金額運算式語言（刻意極簡）：payload key | key*rate | key-key | key+key
--
-- idempotent。依賴既有 helper：current_employee_org() / org_visible() /
-- set_org_default()（20260618100000 起）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. posting_rules ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS posting_rules (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id BIGINT      REFERENCES organizations(id),  -- NULL = 全域預設
  doc_type        TEXT        NOT NULL,
  template_name   TEXT        NOT NULL DEFAULT 'default',
  -- [{account_code, account_name, side('debit'|'credit'), amount_expr, cost_center_from}]
  lines           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UNIQUE(organization_id, doc_type, template_name)：因 NULL 在 UNIQUE 內彼此不等，
-- 拆成兩支 partial unique index 讓「全域列」也吃唯一約束（種子可 ON CONFLICT）。
CREATE UNIQUE INDEX IF NOT EXISTS posting_rules_org_doc_tpl_uniq
  ON posting_rules (organization_id, doc_type, template_name)
  WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS posting_rules_global_doc_tpl_uniq
  ON posting_rules (doc_type, template_name)
  WHERE organization_id IS NULL;

-- ─── 2. journal_entries 冪等鍵欄位 ───────────────────────────────────────────

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_ref  TEXT;

-- 同組織 + 同來源單據只允許一張自動拋轉傳票
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_auto_post_uniq
  ON journal_entries (organization_id, source_type, source_ref)
  WHERE source_type IS NOT NULL AND source_ref IS NOT NULL;

-- ─── 3. RLS（沿用 org_visible / current_employee_org 模式）─────────────────────

ALTER TABLE posting_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS posting_rules_sel ON posting_rules;
CREATE POLICY posting_rules_sel ON posting_rules
  FOR SELECT USING (organization_id IS NULL OR org_visible(organization_id));

-- 只能寫自己組織的規則；全域列（NULL org）僅 service role / migration 可動
DROP POLICY IF EXISTS posting_rules_ins ON posting_rules;
CREATE POLICY posting_rules_ins ON posting_rules
  FOR INSERT WITH CHECK (organization_id = current_employee_org());

DROP POLICY IF EXISTS posting_rules_upd ON posting_rules;
CREATE POLICY posting_rules_upd ON posting_rules
  FOR UPDATE USING (organization_id = current_employee_org())
  WITH CHECK (organization_id = current_employee_org());

DROP POLICY IF EXISTS posting_rules_del ON posting_rules;
CREATE POLICY posting_rules_del ON posting_rules
  FOR DELETE USING (organization_id = current_employee_org());

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION public.posting_rules_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_posting_rules_updated_at ON posting_rules;
CREATE TRIGGER trg_posting_rules_updated_at
  BEFORE UPDATE ON posting_rules
  FOR EACH ROW EXECUTE FUNCTION public.posting_rules_touch_updated_at();

-- ─── 4. 全域預設模板種子（與 src/lib/accounting/postingEngine.js 的
--        DEFAULT_POSTING_TEMPLATES 保持一致，改一邊要同步另一邊）────────────────

INSERT INTO posting_rules (organization_id, doc_type, template_name, lines) VALUES
(NULL, 'sales_shipment', 'default', '[
  {"account_code":"1130","account_name":"應收帳款","side":"debit","amount_expr":"total","cost_center_from":"store_id"},
  {"account_code":"4100","account_name":"營業收入","side":"credit","amount_expr":"total-tax","cost_center_from":"store_id"},
  {"account_code":"2170","account_name":"銷項稅額","side":"credit","amount_expr":"tax","cost_center_from":"store_id"}
]'::jsonb),
(NULL, 'sales_return', 'default', '[
  {"account_code":"4200","account_name":"銷貨退回及折讓","side":"debit","amount_expr":"total-tax","cost_center_from":"store_id"},
  {"account_code":"2170","account_name":"銷項稅額","side":"debit","amount_expr":"tax","cost_center_from":"store_id"},
  {"account_code":"1130","account_name":"應收帳款","side":"credit","amount_expr":"total","cost_center_from":"store_id"}
]'::jsonb),
(NULL, 'purchase_receipt', 'default', '[
  {"account_code":"1150","account_name":"存貨","side":"debit","amount_expr":"total-tax","cost_center_from":"warehouse_id"},
  {"account_code":"1170","account_name":"進項稅額","side":"debit","amount_expr":"tax","cost_center_from":"warehouse_id"},
  {"account_code":"2100","account_name":"應付帳款","side":"credit","amount_expr":"total","cost_center_from":"warehouse_id"}
]'::jsonb),
(NULL, 'purchase_return', 'default', '[
  {"account_code":"2100","account_name":"應付帳款","side":"debit","amount_expr":"total","cost_center_from":"warehouse_id"},
  {"account_code":"1150","account_name":"存貨","side":"credit","amount_expr":"total-tax","cost_center_from":"warehouse_id"},
  {"account_code":"1170","account_name":"進項稅額","side":"credit","amount_expr":"tax","cost_center_from":"warehouse_id"}
]'::jsonb),
(NULL, 'payment_received', 'default', '[
  {"account_code":"1102","account_name":"銀行存款","side":"debit","amount_expr":"amount","cost_center_from":"store_id"},
  {"account_code":"1130","account_name":"應收帳款","side":"credit","amount_expr":"amount","cost_center_from":"store_id"}
]'::jsonb),
(NULL, 'payment_made', 'default', '[
  {"account_code":"2100","account_name":"應付帳款","side":"debit","amount_expr":"amount","cost_center_from":"store_id"},
  {"account_code":"1102","account_name":"銀行存款","side":"credit","amount_expr":"amount","cost_center_from":"store_id"}
]'::jsonb),
(NULL, 'inventory_count', 'default', '[
  {"account_code":"5150","account_name":"存貨盤損","side":"debit","amount_expr":"amount","cost_center_from":"warehouse_id"},
  {"account_code":"1150","account_name":"存貨","side":"credit","amount_expr":"amount","cost_center_from":"warehouse_id"}
]'::jsonb),
(NULL, 'inventory_count', 'overage', '[
  {"account_code":"1150","account_name":"存貨","side":"debit","amount_expr":"amount","cost_center_from":"warehouse_id"},
  {"account_code":"7400","account_name":"存貨盤盈","side":"credit","amount_expr":"amount","cost_center_from":"warehouse_id"}
]'::jsonb),
(NULL, 'payroll_monthly', 'default', '[
  {"account_code":"6100","account_name":"薪資費用","side":"debit","amount_expr":"gross","cost_center_from":"department"},
  {"account_code":"2120","account_name":"應付薪資","side":"credit","amount_expr":"net","cost_center_from":"department"},
  {"account_code":"2130","account_name":"代扣款項","side":"credit","amount_expr":"gross-net","cost_center_from":"department"}
]'::jsonb),
(NULL, 'depreciation_monthly', 'default', '[
  {"account_code":"6300","account_name":"折舊費用","side":"debit","amount_expr":"amount","cost_center_from":"cost_center"},
  {"account_code":"1610","account_name":"累計折舊","side":"credit","amount_expr":"amount","cost_center_from":"cost_center"}
]'::jsonb),
(NULL, 'open_item_settle', 'default', '[
  {"account_code":"2260","account_name":"預收貨款","side":"debit","amount_expr":"amount","cost_center_from":"store_id"},
  {"account_code":"4100","account_name":"營業收入","side":"credit","amount_expr":"amount","cost_center_from":"store_id"}
]'::jsonb)
ON CONFLICT (doc_type, template_name) WHERE organization_id IS NULL DO NOTHING;

-- ─── 5. 金額運算式求值（極簡語言：key | key*rate | key-key | key+key）──────────

CREATE OR REPLACE FUNCTION public.posting_eval_amount(p_expr TEXT, p_payload JSONB)
RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expr TEXT;
  v_k1   TEXT;
  v_k2   TEXT;
  v_rate NUMERIC;
BEGIN
  IF p_expr IS NULL OR btrim(p_expr) = '' THEN RETURN 0; END IF;
  v_expr := replace(p_expr, ' ', '');

  IF v_expr ~ '^[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    RETURN round(COALESCE((p_payload->>v_expr)::numeric, 0), 2);
  ELSIF v_expr ~ '^[a-zA-Z_][a-zA-Z0-9_]*\*[0-9]+(\.[0-9]+)?$' THEN
    v_k1   := split_part(v_expr, '*', 1);
    v_rate := split_part(v_expr, '*', 2)::numeric;
    RETURN round(COALESCE((p_payload->>v_k1)::numeric, 0) * v_rate, 2);
  ELSIF v_expr ~ '^[a-zA-Z_][a-zA-Z0-9_]*-[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    v_k1 := split_part(v_expr, '-', 1);
    v_k2 := split_part(v_expr, '-', 2);
    RETURN round(COALESCE((p_payload->>v_k1)::numeric, 0) - COALESCE((p_payload->>v_k2)::numeric, 0), 2);
  ELSIF v_expr ~ '^[a-zA-Z_][a-zA-Z0-9_]*\+[a-zA-Z_][a-zA-Z0-9_]*$' THEN
    v_k1 := split_part(v_expr, '+', 1);
    v_k2 := split_part(v_expr, '+', 2);
    RETURN round(COALESCE((p_payload->>v_k1)::numeric, 0) + COALESCE((p_payload->>v_k2)::numeric, 0), 2);
  ELSE
    RAISE EXCEPTION '不支援的金額運算式：%（僅支援 key / key*rate / key-key / key+key）', p_expr;
  END IF;
END $$;

-- ─── 6. RPC：secure_auto_post_voucher ────────────────────────────────────────
-- 金流寫入一律 RPC（SECURITY DEFINER），與 secure_create_journal_entry 同模式。
-- 回傳值：
--   journal_entries 列  → 已建立（或冪等命中既有）的傳票
--   NULL               → 規則存在但已停用（刻意不拋轉，不算錯誤）
-- 例外：找不到規則 / 運算式不合法 / 借貸不平衡 / 科目無法解析

CREATE OR REPLACE FUNCTION public.secure_auto_post_voucher(
  p_doc_type    TEXT,
  p_source_type TEXT,
  p_source_id   TEXT,
  p_payload     JSONB DEFAULT '{}'::jsonb
) RETURNS journal_entries
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid          INT;
  v_rule         posting_rules;
  v_entry        journal_entries;
  v_line         JSONB;
  v_lines        JSONB := '[]'::jsonb;
  v_code         TEXT;
  v_name         TEXT;
  v_side         TEXT;
  v_amount       NUMERIC;
  v_cc           TEXT;
  v_idx          INT := 0;
  v_total_debit  NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_template     TEXT;
  v_entry_number TEXT;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_doc_type IS NULL OR p_doc_type = '' THEN RAISE EXCEPTION '缺少單據類型 doc_type'; END IF;
  IF p_source_type IS NULL OR p_source_type = '' OR p_source_id IS NULL OR p_source_id = '' THEN
    RAISE EXCEPTION '缺少來源單據識別（source_type / source_id）';
  END IF;

  -- 冪等：同來源已拋轉 → 回傳既有傳票，不重複入帳
  SELECT * INTO v_entry FROM journal_entries
   WHERE organization_id = v_tid
     AND source_type = p_source_type
     AND source_ref  = p_source_id
   LIMIT 1;
  IF FOUND THEN RETURN v_entry; END IF;

  -- 規則解析：組織自訂優先於全域預設；payload 可用 _template 指定模板（預設 default）。
  -- 先依「特定性」選出最適規則，再看啟停 — 組織把規則停用（copy-on-write 一列
  -- is_active=false）時不得回落到仍啟用的全域預設。
  v_template := COALESCE(p_payload->>'_template', 'default');

  SELECT * INTO v_rule FROM posting_rules
   WHERE doc_type = p_doc_type
     AND template_name = v_template
     AND (organization_id = v_tid OR organization_id IS NULL)
   ORDER BY organization_id NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到拋轉規則：% / %', p_doc_type, v_template;
  END IF;
  IF NOT v_rule.is_active THEN
    RETURN NULL;  -- 規則已停用 → 刻意不拋轉（非錯誤）
  END IF;

  IF v_rule.lines IS NULL OR jsonb_array_length(v_rule.lines) < 2 THEN
    RAISE EXCEPTION '拋轉規則明細不足（至少一借一貸）：%', p_doc_type;
  END IF;

  -- 逐行求值
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_rule.lines) LOOP
    v_idx  := v_idx + 1;
    v_code := v_line->>'account_code';
    v_side := lower(COALESCE(v_line->>'side', ''));

    IF v_code IS NULL OR v_code = '' THEN RAISE EXCEPTION '規則第 % 行缺少科目代碼', v_idx; END IF;
    IF v_side NOT IN ('debit', 'credit') THEN
      RAISE EXCEPTION '規則第 % 行 side 必須為 debit 或 credit', v_idx;
    END IF;

    v_amount := posting_eval_amount(v_line->>'amount_expr', p_payload);
    IF v_amount < 0 THEN RAISE EXCEPTION '規則第 % 行金額為負：%', v_idx, v_amount; END IF;
    CONTINUE WHEN v_amount = 0;  -- 稅額 0 等情況：整行略過

    -- 科目名稱解析：accounts 表優先，其次模板行內 account_name；兩者皆無 → 錯誤浮出
    SELECT name INTO v_name FROM accounts
     WHERE code = v_code AND (organization_id = v_tid OR organization_id IS NULL)
     ORDER BY organization_id NULLS LAST LIMIT 1;
    IF v_name IS NULL THEN v_name := NULLIF(v_line->>'account_name', ''); END IF;
    IF v_name IS NULL THEN
      RAISE EXCEPTION '科目不存在且規則未提供科目名稱：%（doc_type=%）', v_code, p_doc_type;
    END IF;

    v_cc := CASE
      WHEN COALESCE(v_line->>'cost_center_from', '') <> ''
      THEN p_payload->>(v_line->>'cost_center_from')
    END;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', v_code,
      'account_name', v_name,
      'debit',  CASE WHEN v_side = 'debit'  THEN v_amount ELSE 0 END,
      'credit', CASE WHEN v_side = 'credit' THEN v_amount ELSE 0 END,
      'memo',   COALESCE(p_payload->>'memo', p_source_type || ':' || p_source_id),
      'cost_center', v_cc
    ));

    IF v_side = 'debit' THEN v_total_debit := v_total_debit + v_amount;
    ELSE v_total_credit := v_total_credit + v_amount;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_lines) < 2 THEN
    RAISE EXCEPTION '拋轉後有效明細不足（金額全為 0？）：doc_type=%, payload=%', p_doc_type, p_payload;
  END IF;
  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION '借貸不平衡：借方 %, 貸方 %, 差額 %（doc_type=%）',
      v_total_debit, v_total_credit, ABS(v_total_debit - v_total_credit), p_doc_type;
  END IF;

  v_entry_number := 'JE-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('journal_entries_id_seq')::TEXT, 6, '0');

  BEGIN
    INSERT INTO journal_entries (organization_id, entry_number, entry_date, description,
                                 source, source_type, source_ref, created_by, status)
    VALUES (
      v_tid,
      v_entry_number,
      COALESCE(NULLIF(p_payload->>'entry_date', '')::date, CURRENT_DATE),
      COALESCE(NULLIF(p_payload->>'description', ''), p_doc_type || ' 自動拋轉 (' || p_source_id || ')'),
      p_doc_type,
      p_source_type,
      p_source_id,
      COALESCE(NULLIF(p_payload->>'created_by', ''), '系統(自動拋轉)'),
      '草稿'
    )
    RETURNING * INTO v_entry;
  EXCEPTION WHEN unique_violation THEN
    -- 併發下第二筆撞冪等唯一索引 → 回傳先到的那張
    SELECT * INTO v_entry FROM journal_entries
     WHERE organization_id = v_tid AND source_type = p_source_type AND source_ref = p_source_id
     LIMIT 1;
    RETURN v_entry;
  END;

  INSERT INTO journal_lines (organization_id, entry_id, account_code, account_name, debit, credit, memo, cost_center)
  SELECT v_tid, v_entry.id,
         elem->>'account_code',
         elem->>'account_name',
         COALESCE((elem->>'debit')::numeric, 0),
         COALESCE((elem->>'credit')::numeric, 0),
         elem->>'memo',
         NULLIF(elem->>'cost_center', '')
  FROM jsonb_array_elements(v_lines) AS elem;

  RETURN v_entry;
END $$;

GRANT EXECUTE ON FUNCTION public.secure_auto_post_voucher(TEXT, TEXT, TEXT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_auto_post_voucher(TEXT, TEXT, TEXT, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.posting_eval_amount(TEXT, JSONB) FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
