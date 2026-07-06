-- ════════════════════════════════════════════════════════════════════════════
-- F-A3 立沖帳（預收付/暫收付）
-- 2026-07-05
--
-- 1. open_items：立沖單（預收/預付/暫收/暫付；amount / settled_amount / status）
-- 2. open_item_settlements：沖銷紀錄（部分沖銷、多筆對一）
-- 3. posting_rules 種子：doc_type 'open_item_create'（立帳）與 'open_item_settle'
--    （沖銷）各 4 個模板，template_name = item_type，經 F-A2 secure_auto_post_voucher
-- 4. RPC secure_create_open_item：建立立沖單 + 自動拋立帳傳票
--    RPC secure_settle_open_item：row-lock → 擋超沖 → 寫沖銷紀錄 → 更新餘額/狀態
--    → 自動拋沖銷傳票（方向依 item_type 模板）
--
-- 科目（對齊 20260705142000_account_seeds.sql / constants.js）：
--   預收 2260 預收貨款｜預付 1140 預付款項（1150 為存貨，故不用）
--   暫收 2270 暫收款  ｜暫付 1160 暫付款
--
-- 寫入一律走 SECURITY DEFINER RPC（金流寫入規範）；資料表僅開 SELECT RLS。
-- idempotent。依賴：current_employee_org() / org_visible() /
-- secure_auto_post_voucher（20260705100000）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. open_items ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS open_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  BIGINT      NOT NULL REFERENCES organizations(id),
  item_type        TEXT        NOT NULL CHECK (item_type IN ('預收', '預付', '暫收', '暫付')),
  account_code     TEXT        NOT NULL,
  party_type       TEXT        CHECK (party_type IS NULL OR party_type IN ('客戶', '供應商', '員工')),
  party_id         TEXT,
  party_name       TEXT,
  source_type      TEXT,
  source_id        TEXT,
  amount           NUMERIC     NOT NULL CHECK (amount > 0),
  settled_amount   NUMERIC     NOT NULL DEFAULT 0 CHECK (settled_amount >= 0 AND settled_amount <= amount),
  status           TEXT        NOT NULL DEFAULT '未沖' CHECK (status IN ('未沖', '部分沖', '已沖')),
  memo             TEXT,
  journal_entry_id INT         REFERENCES journal_entries(id),  -- 立帳傳票
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_open_items_org_status ON open_items (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_open_items_org_type   ON open_items (organization_id, item_type);

-- 同來源單據 + 同類型只允許一張立沖單（RPC 冪等鍵；重放回傳既有列）
CREATE UNIQUE INDEX IF NOT EXISTS open_items_source_uniq
  ON open_items (organization_id, item_type, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

-- ─── 2. open_item_settlements ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS open_item_settlements (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  BIGINT      NOT NULL REFERENCES organizations(id),
  open_item_id     UUID        NOT NULL REFERENCES open_items(id) ON DELETE CASCADE,
  settle_doc_type  TEXT,
  settle_doc_id    TEXT,
  amount           NUMERIC     NOT NULL CHECK (amount > 0),
  journal_entry_id INT         REFERENCES journal_entries(id),  -- 沖銷傳票
  settled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_by       TEXT
);

CREATE INDEX IF NOT EXISTS idx_open_item_settlements_item ON open_item_settlements (open_item_id);
CREATE INDEX IF NOT EXISTS idx_open_item_settlements_org  ON open_item_settlements (organization_id);

-- ─── 3. RLS：讀本組織；寫一律走 RPC（不開 INSERT/UPDATE/DELETE policy）──────────

ALTER TABLE open_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_item_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS open_items_sel ON open_items;
CREATE POLICY open_items_sel ON open_items
  FOR SELECT USING (org_visible(organization_id));

DROP POLICY IF EXISTS open_item_settlements_sel ON open_item_settlements;
CREATE POLICY open_item_settlements_sel ON open_item_settlements
  FOR SELECT USING (org_visible(organization_id));

-- ─── 4. posting_rules 種子（全域預設；org 可 copy-on-write 覆寫）────────────────
-- 立帳 open_item_create：現金收付 vs 立沖科目
-- 沖銷 open_item_settle：方向依 item_type（template_name = item_type）
--   （20260705100000 已種 open_item_settle/default = 預收沖轉收入，保留不動）

INSERT INTO posting_rules (organization_id, doc_type, template_name, lines) VALUES
(NULL, 'open_item_create', '預收', '[
  {"account_code":"1100","account_name":"現金","side":"debit","amount_expr":"amount","cost_center_from":"store_id"},
  {"account_code":"2260","account_name":"預收貨款","side":"credit","amount_expr":"amount","cost_center_from":"store_id"}
]'::jsonb),
(NULL, 'open_item_create', '預付', '[
  {"account_code":"1140","account_name":"預付款項","side":"debit","amount_expr":"amount","cost_center_from":"store_id"},
  {"account_code":"1100","account_name":"現金","side":"credit","amount_expr":"amount","cost_center_from":"store_id"}
]'::jsonb),
(NULL, 'open_item_create', '暫收', '[
  {"account_code":"1100","account_name":"現金","side":"debit","amount_expr":"amount","cost_center_from":"store_id"},
  {"account_code":"2270","account_name":"暫收款","side":"credit","amount_expr":"amount","cost_center_from":"store_id"}
]'::jsonb),
(NULL, 'open_item_create', '暫付', '[
  {"account_code":"1160","account_name":"暫付款","side":"debit","amount_expr":"amount","cost_center_from":"store_id"},
  {"account_code":"1100","account_name":"現金","side":"credit","amount_expr":"amount","cost_center_from":"store_id"}
]'::jsonb),
(NULL, 'open_item_settle', '預收', '[
  {"account_code":"2260","account_name":"預收貨款","side":"debit","amount_expr":"amount","cost_center_from":"store_id"},
  {"account_code":"4100","account_name":"營業收入","side":"credit","amount_expr":"amount","cost_center_from":"store_id"}
]'::jsonb),
(NULL, 'open_item_settle', '預付', '[
  {"account_code":"2100","account_name":"應付帳款","side":"debit","amount_expr":"amount","cost_center_from":"store_id"},
  {"account_code":"1140","account_name":"預付款項","side":"credit","amount_expr":"amount","cost_center_from":"store_id"}
]'::jsonb),
(NULL, 'open_item_settle', '暫收', '[
  {"account_code":"2270","account_name":"暫收款","side":"debit","amount_expr":"amount","cost_center_from":"store_id"},
  {"account_code":"1130","account_name":"應收帳款","side":"credit","amount_expr":"amount","cost_center_from":"store_id"}
]'::jsonb),
(NULL, 'open_item_settle', '暫付', '[
  {"account_code":"2100","account_name":"應付帳款","side":"debit","amount_expr":"amount","cost_center_from":"store_id"},
  {"account_code":"1160","account_name":"暫付款","side":"credit","amount_expr":"amount","cost_center_from":"store_id"}
]'::jsonb)
ON CONFLICT (doc_type, template_name) WHERE organization_id IS NULL DO NOTHING;

-- ─── 5. RPC：secure_create_open_item ─────────────────────────────────────────
-- 建立立沖單並經 F-A2 拋立帳傳票（doc_type 'open_item_create'，_template=item_type）。
-- 帶 source_type/source_id 時冪等：重放回傳既有列，不重複立帳。

CREATE OR REPLACE FUNCTION public.secure_create_open_item(
  p_item_type    TEXT,
  p_amount       NUMERIC,
  p_account_code TEXT  DEFAULT NULL,
  p_party_type   TEXT  DEFAULT NULL,
  p_party_id     TEXT  DEFAULT NULL,
  p_party_name   TEXT  DEFAULT NULL,
  p_source_type  TEXT  DEFAULT NULL,
  p_source_id    TEXT  DEFAULT NULL,
  p_memo         TEXT  DEFAULT NULL,
  p_payload      JSONB DEFAULT '{}'::jsonb
) RETURNS open_items
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid     INT;
  v_item    open_items;
  v_entry   journal_entries;
  v_account TEXT;
  v_actor   TEXT;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_item_type IS NULL OR p_item_type NOT IN ('預收', '預付', '暫收', '暫付') THEN
    RAISE EXCEPTION '不合法的立沖類型：%（僅支援 預收/預付/暫收/暫付）', p_item_type;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION '立帳金額必須大於 0：%', p_amount;
  END IF;

  -- 預設立沖科目（可由 p_account_code 覆寫）
  v_account := COALESCE(NULLIF(p_account_code, ''), CASE p_item_type
    WHEN '預收' THEN '2260'
    WHEN '預付' THEN '1140'
    WHEN '暫收' THEN '2270'
    ELSE '1160'
  END);

  v_actor := COALESCE(
    NULLIF(p_payload->>'created_by', ''),
    (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()),
    '系統'
  );

  -- 冪等：同來源同類型已立帳 → 回傳既有列
  IF p_source_type IS NOT NULL AND p_source_id IS NOT NULL THEN
    SELECT * INTO v_item FROM open_items
     WHERE organization_id = v_tid AND item_type = p_item_type
       AND source_type = p_source_type AND source_id = p_source_id
     LIMIT 1;
    IF FOUND THEN RETURN v_item; END IF;
  END IF;

  BEGIN
    INSERT INTO open_items (organization_id, item_type, account_code, party_type, party_id,
                            party_name, source_type, source_id, amount, memo, created_by)
    VALUES (v_tid, p_item_type, v_account, NULLIF(p_party_type, ''), NULLIF(p_party_id, ''),
            NULLIF(p_party_name, ''), NULLIF(p_source_type, ''), NULLIF(p_source_id, ''),
            p_amount, NULLIF(p_memo, ''), v_actor)
    RETURNING * INTO v_item;
  EXCEPTION WHEN unique_violation THEN
    -- 併發重放撞冪等唯一索引 → 回傳先到的那張
    SELECT * INTO v_item FROM open_items
     WHERE organization_id = v_tid AND item_type = p_item_type
       AND source_type = p_source_type AND source_id = p_source_id
     LIMIT 1;
    RETURN v_item;
  END;

  -- 立帳傳票（規則停用 → 回 NULL，立沖單仍成立、不掛傳票）
  v_entry := secure_auto_post_voucher(
    'open_item_create',
    'finance.open_item',
    v_item.id::TEXT,
    p_payload || jsonb_build_object(
      '_template', p_item_type,
      'amount', p_amount,
      'description', COALESCE(NULLIF(p_payload->>'description', ''),
        p_item_type || '立帳' || COALESCE('：' || NULLIF(p_memo, ''), '')),
      'created_by', v_actor
    )
  );

  IF v_entry.id IS NOT NULL THEN
    UPDATE open_items SET journal_entry_id = v_entry.id, updated_at = now()
     WHERE id = v_item.id
     RETURNING * INTO v_item;
  END IF;

  RETURN v_item;
END $$;

-- ─── 6. RPC：secure_settle_open_item ─────────────────────────────────────────
-- row-lock → 擋超沖 → 拋沖銷傳票（doc_type 'open_item_settle'，_template=item_type）
-- → 寫沖銷紀錄 → 更新 settled_amount / status，回傳更新後立沖單。

CREATE OR REPLACE FUNCTION public.secure_settle_open_item(
  p_open_item_id    UUID,
  p_amount          NUMERIC,
  p_settle_doc_type TEXT  DEFAULT NULL,
  p_settle_doc_id   TEXT  DEFAULT NULL,
  p_payload         JSONB DEFAULT '{}'::jsonb
) RETURNS open_items
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid       INT;
  v_item      open_items;
  v_entry     journal_entries;
  v_settle_id UUID := gen_random_uuid();
  v_remaining NUMERIC;
  v_settled   NUMERIC;
  v_actor     TEXT;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION '沖銷金額必須大於 0：%', p_amount;
  END IF;

  SELECT * INTO v_item FROM open_items
   WHERE id = p_open_item_id AND organization_id = v_tid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '找不到立沖單：%', p_open_item_id; END IF;

  IF v_item.status = '已沖' THEN
    RAISE EXCEPTION '立沖單已全數沖銷，不可再沖：%', p_open_item_id;
  END IF;

  v_remaining := v_item.amount - v_item.settled_amount;
  IF p_amount > v_remaining THEN
    RAISE EXCEPTION '沖銷金額 % 超過未沖餘額 %', p_amount, v_remaining;
  END IF;

  v_actor := COALESCE(
    NULLIF(p_payload->>'settled_by', ''),
    (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()),
    '系統'
  );

  -- 沖銷傳票（方向依 item_type 模板；規則停用 → NULL，仍記沖銷）
  v_entry := secure_auto_post_voucher(
    'open_item_settle',
    'finance.open_item_settlement',
    v_settle_id::TEXT,
    p_payload || jsonb_build_object(
      '_template', v_item.item_type,
      'amount', p_amount,
      'description', COALESCE(NULLIF(p_payload->>'description', ''),
        v_item.item_type || '沖銷' ||
        COALESCE('：' || NULLIF(p_settle_doc_type, '') || ' ' || COALESCE(p_settle_doc_id, ''), '')),
      'created_by', v_actor
    )
  );

  INSERT INTO open_item_settlements (id, organization_id, open_item_id, settle_doc_type,
                                     settle_doc_id, amount, journal_entry_id, settled_by)
  VALUES (v_settle_id, v_tid, v_item.id, NULLIF(p_settle_doc_type, ''),
          NULLIF(p_settle_doc_id, ''), p_amount, v_entry.id, v_actor);

  v_settled := v_item.settled_amount + p_amount;

  UPDATE open_items
     SET settled_amount = v_settled,
         status = CASE WHEN v_settled >= amount THEN '已沖'
                       WHEN v_settled > 0 THEN '部分沖'
                       ELSE '未沖' END,
         updated_at = now()
   WHERE id = v_item.id
   RETURNING * INTO v_item;

  RETURN v_item;
END $$;

GRANT EXECUTE ON FUNCTION public.secure_create_open_item(TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_create_open_item(TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.secure_settle_open_item(UUID, NUMERIC, TEXT, TEXT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_settle_open_item(UUID, NUMERIC, TEXT, TEXT, JSONB) FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
