-- ════════════════════════════════════════════════════════════════════════════
-- F-A4 票據管理（應收票據 / 應付票據）
-- 2026-07-05
--
-- 1. notes_receivable / notes_payable：票據主檔 + 狀態 CHECK
-- 2. posting_rules 種子：doc_type 'note_transition'，8 個模板（_template 選擇）
-- 3. RPC secure_register_note：票據登錄（AR 收票 / AP 開票）+ 自動拋傳票
--    RPC secure_transition_note：合法狀態機轉換 + 每次轉換自動拋傳票
--
-- 狀態機（與 src/lib/accounting/notes.js NOTE_TRANSITIONS 對齊，改一邊要同步）：
--   應收：在庫 --collect--> 託收 --honor--> 兌現
--                託收 --bounce--> 退票 --collect--> 託收（重新提示）
--                                 退票 --return--> 轉回（轉回應收帳款）
--   應付：開立 --honor--> 兌現｜開立 --void--> 作廢
--
-- 科目（對齊 constants.js：應收票據 1141、應付票據 2110 為既有碼；託收票據取 1142）：
--   收票 ar_receive：借 1141 應收票據 / 貸 1130 應收帳款
--   託收 ar_collect：借 1142 託收票據 / 貸 1141 應收票據
--   兌現 ar_honor  ：借 1102 銀行存款 / 貸 1142 託收票據
--   退票 ar_bounce ：借 1141 應收票據 / 貸 1142 託收票據（託收反向）
--   轉回 ar_return ：借 1130 應收帳款 / 貸 1141 應收票據（轉列催收）
--   開票 ap_issue  ：借 2100 應付帳款 / 貸 2110 應付票據
--   兌現 ap_honor  ：借 2110 應付票據 / 貸 1102 銀行存款
--   作廢 ap_void   ：借 2110 應付票據 / 貸 2100 應付帳款（回沖應付）
--
-- 寫入一律走 SECURITY DEFINER RPC；資料表僅開 SELECT RLS。idempotent。
-- 依賴：current_employee_org() / org_visible() / secure_auto_post_voucher。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 票據主檔 ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notes_receivable (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  BIGINT      NOT NULL REFERENCES organizations(id),
  note_number      TEXT        NOT NULL,
  bank             TEXT,
  due_date         DATE,
  amount           NUMERIC     NOT NULL CHECK (amount > 0),
  party_type       TEXT        DEFAULT '客戶',
  party_id         TEXT,
  party_name       TEXT,
  source_type      TEXT,
  source_id        TEXT,
  status           TEXT        NOT NULL DEFAULT '在庫'
                               CHECK (status IN ('在庫', '託收', '兌現', '退票', '轉回')),
  transition_seq   INT         NOT NULL DEFAULT 0,   -- 傳票冪等鍵之一（每次轉換 +1）
  journal_entry_id INT         REFERENCES journal_entries(id),  -- 最近一次轉換傳票
  memo             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes_payable (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  BIGINT      NOT NULL REFERENCES organizations(id),
  note_number      TEXT        NOT NULL,
  bank             TEXT,
  due_date         DATE,
  amount           NUMERIC     NOT NULL CHECK (amount > 0),
  party_type       TEXT        DEFAULT '供應商',
  party_id         TEXT,
  party_name       TEXT,
  source_type      TEXT,
  source_id        TEXT,
  status           TEXT        NOT NULL DEFAULT '開立'
                               CHECK (status IN ('開立', '兌現', '作廢')),
  transition_seq   INT         NOT NULL DEFAULT 0,
  journal_entry_id INT         REFERENCES journal_entries(id),
  memo             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notes_receivable_org_number_uniq
  ON notes_receivable (organization_id, note_number);
CREATE UNIQUE INDEX IF NOT EXISTS notes_payable_org_number_uniq
  ON notes_payable (organization_id, note_number);
CREATE INDEX IF NOT EXISTS idx_notes_receivable_org_due ON notes_receivable (organization_id, due_date);
CREATE INDEX IF NOT EXISTS idx_notes_payable_org_due    ON notes_payable (organization_id, due_date);

-- ─── 2. RLS：讀本組織；寫一律走 RPC ─────────────────────────────────────────────

ALTER TABLE notes_receivable ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes_payable    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notes_receivable_sel ON notes_receivable;
CREATE POLICY notes_receivable_sel ON notes_receivable
  FOR SELECT USING (org_visible(organization_id));

DROP POLICY IF EXISTS notes_payable_sel ON notes_payable;
CREATE POLICY notes_payable_sel ON notes_payable
  FOR SELECT USING (org_visible(organization_id));

-- ─── 3. posting_rules 種子（doc_type 'note_transition'，_template 選模板）───────

INSERT INTO posting_rules (organization_id, doc_type, template_name, lines) VALUES
(NULL, 'note_transition', 'ar_receive', '[
  {"account_code":"1141","account_name":"應收票據","side":"debit","amount_expr":"amount"},
  {"account_code":"1130","account_name":"應收帳款","side":"credit","amount_expr":"amount"}
]'::jsonb),
(NULL, 'note_transition', 'ar_collect', '[
  {"account_code":"1142","account_name":"託收票據","side":"debit","amount_expr":"amount"},
  {"account_code":"1141","account_name":"應收票據","side":"credit","amount_expr":"amount"}
]'::jsonb),
(NULL, 'note_transition', 'ar_honor', '[
  {"account_code":"1102","account_name":"銀行存款","side":"debit","amount_expr":"amount"},
  {"account_code":"1142","account_name":"託收票據","side":"credit","amount_expr":"amount"}
]'::jsonb),
(NULL, 'note_transition', 'ar_bounce', '[
  {"account_code":"1141","account_name":"應收票據","side":"debit","amount_expr":"amount"},
  {"account_code":"1142","account_name":"託收票據","side":"credit","amount_expr":"amount"}
]'::jsonb),
(NULL, 'note_transition', 'ar_return', '[
  {"account_code":"1130","account_name":"應收帳款","side":"debit","amount_expr":"amount"},
  {"account_code":"1141","account_name":"應收票據","side":"credit","amount_expr":"amount"}
]'::jsonb),
(NULL, 'note_transition', 'ap_issue', '[
  {"account_code":"2100","account_name":"應付帳款","side":"debit","amount_expr":"amount"},
  {"account_code":"2110","account_name":"應付票據","side":"credit","amount_expr":"amount"}
]'::jsonb),
(NULL, 'note_transition', 'ap_honor', '[
  {"account_code":"2110","account_name":"應付票據","side":"debit","amount_expr":"amount"},
  {"account_code":"1102","account_name":"銀行存款","side":"credit","amount_expr":"amount"}
]'::jsonb),
(NULL, 'note_transition', 'ap_void', '[
  {"account_code":"2110","account_name":"應付票據","side":"debit","amount_expr":"amount"},
  {"account_code":"2100","account_name":"應付帳款","side":"credit","amount_expr":"amount"}
]'::jsonb)
ON CONFLICT (doc_type, template_name) WHERE organization_id IS NULL DO NOTHING;

-- ─── 4. RPC：secure_register_note（票據登錄 + 自動拋傳票）───────────────────────
-- p_note_kind：'receivable' | 'payable'
-- p_note：{note_number, bank, due_date, amount, party_id, party_name, source_type,
--          source_id, memo, ...}；回傳 to_jsonb(票據列)。

CREATE OR REPLACE FUNCTION public.secure_register_note(
  p_note_kind TEXT,
  p_note      JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid     INT;
  v_ar      notes_receivable;
  v_ap      notes_payable;
  v_entry   journal_entries;
  v_number  TEXT;
  v_amount  NUMERIC;
  v_actor   TEXT;
  v_payload JSONB;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_note_kind NOT IN ('receivable', 'payable') THEN
    RAISE EXCEPTION '不合法的票據種類：%（僅支援 receivable / payable）', p_note_kind;
  END IF;

  v_number := NULLIF(p_note->>'note_number', '');
  IF v_number IS NULL THEN RAISE EXCEPTION '缺少票據號碼 note_number'; END IF;

  v_amount := (p_note->>'amount')::NUMERIC;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION '票據金額必須大於 0：%', p_note->>'amount';
  END IF;

  v_actor := COALESCE(
    NULLIF(p_note->>'created_by', ''),
    (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()),
    '系統'
  );

  v_payload := jsonb_build_object(
    'amount', v_amount,
    '_template', CASE p_note_kind WHEN 'receivable' THEN 'ar_receive' ELSE 'ap_issue' END,
    'description', CASE p_note_kind WHEN 'receivable' THEN '收受應收票據 ' ELSE '開立應付票據 ' END || v_number,
    'created_by', v_actor
  );

  IF p_note_kind = 'receivable' THEN
    INSERT INTO notes_receivable (organization_id, note_number, bank, due_date, amount,
                                  party_type, party_id, party_name, source_type, source_id, memo, created_by)
    VALUES (v_tid, v_number, NULLIF(p_note->>'bank', ''), NULLIF(p_note->>'due_date', '')::DATE,
            v_amount, COALESCE(NULLIF(p_note->>'party_type', ''), '客戶'),
            NULLIF(p_note->>'party_id', ''), NULLIF(p_note->>'party_name', ''),
            NULLIF(p_note->>'source_type', ''), NULLIF(p_note->>'source_id', ''),
            NULLIF(p_note->>'memo', ''), v_actor)
    RETURNING * INTO v_ar;

    v_entry := secure_auto_post_voucher('note_transition', 'finance.note_receivable',
                                        v_ar.id::TEXT || ':0:register', v_payload);
    IF v_entry.id IS NOT NULL THEN
      UPDATE notes_receivable SET journal_entry_id = v_entry.id, updated_at = now()
       WHERE id = v_ar.id RETURNING * INTO v_ar;
    END IF;
    RETURN to_jsonb(v_ar);
  ELSE
    INSERT INTO notes_payable (organization_id, note_number, bank, due_date, amount,
                               party_type, party_id, party_name, source_type, source_id, memo, created_by)
    VALUES (v_tid, v_number, NULLIF(p_note->>'bank', ''), NULLIF(p_note->>'due_date', '')::DATE,
            v_amount, COALESCE(NULLIF(p_note->>'party_type', ''), '供應商'),
            NULLIF(p_note->>'party_id', ''), NULLIF(p_note->>'party_name', ''),
            NULLIF(p_note->>'source_type', ''), NULLIF(p_note->>'source_id', ''),
            NULLIF(p_note->>'memo', ''), v_actor)
    RETURNING * INTO v_ap;

    v_entry := secure_auto_post_voucher('note_transition', 'finance.note_payable',
                                        v_ap.id::TEXT || ':0:register', v_payload);
    IF v_entry.id IS NOT NULL THEN
      UPDATE notes_payable SET journal_entry_id = v_entry.id, updated_at = now()
       WHERE id = v_ap.id RETURNING * INTO v_ap;
    END IF;
    RETURN to_jsonb(v_ap);
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION '票據號碼重複：%（同組織不可重複登錄）', v_number;
END $$;

-- ─── 5. RPC：secure_transition_note（合法狀態機 + 每次轉換拋傳票）────────────────
-- 動作：receivable → collect / honor / bounce / return；payable → honor / void。
-- 非法轉換 → 明確錯誤。傳票冪等鍵 = note_id:seq:action（重新提示託收不會撞鍵）。

CREATE OR REPLACE FUNCTION public.secure_transition_note(
  p_note_kind TEXT,
  p_note_id   UUID,
  p_action    TEXT,
  p_payload   JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tid      INT;
  v_ar       notes_receivable;
  v_ap       notes_payable;
  v_entry    journal_entries;
  v_from     TEXT;
  v_to       TEXT;
  v_template TEXT;
  v_seq      INT;
  v_amount   NUMERIC;
  v_number   TEXT;
  v_actor    TEXT;
  v_label    TEXT;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_note_kind NOT IN ('receivable', 'payable') THEN
    RAISE EXCEPTION '不合法的票據種類：%（僅支援 receivable / payable）', p_note_kind;
  END IF;

  -- 鎖定票據列、取目前狀態
  IF p_note_kind = 'receivable' THEN
    SELECT * INTO v_ar FROM notes_receivable
     WHERE id = p_note_id AND organization_id = v_tid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '找不到應收票據：%', p_note_id; END IF;
    v_from := v_ar.status; v_seq := v_ar.transition_seq + 1;
    v_amount := v_ar.amount; v_number := v_ar.note_number;

    v_to := CASE
      WHEN p_action = 'collect' AND v_from IN ('在庫', '退票') THEN '託收'
      WHEN p_action = 'honor'   AND v_from = '託收'            THEN '兌現'
      WHEN p_action = 'bounce'  AND v_from = '託收'            THEN '退票'
      WHEN p_action = 'return'  AND v_from = '退票'            THEN '轉回'
    END;
    v_template := 'ar_' || p_action;
  ELSE
    SELECT * INTO v_ap FROM notes_payable
     WHERE id = p_note_id AND organization_id = v_tid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '找不到應付票據：%', p_note_id; END IF;
    v_from := v_ap.status; v_seq := v_ap.transition_seq + 1;
    v_amount := v_ap.amount; v_number := v_ap.note_number;

    v_to := CASE
      WHEN p_action = 'honor' AND v_from = '開立' THEN '兌現'
      WHEN p_action = 'void'  AND v_from = '開立' THEN '作廢'
    END;
    v_template := 'ap_' || p_action;
  END IF;

  IF v_to IS NULL THEN
    RAISE EXCEPTION '不允許的票據狀態轉換：票據 %（目前狀態「%」）不能執行動作「%」',
      v_number, v_from, p_action;
  END IF;

  v_actor := COALESCE(
    NULLIF(p_payload->>'created_by', ''),
    (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()),
    '系統'
  );
  v_label := '票據 ' || v_number || '：' || v_from || ' → ' || v_to;

  -- 每次轉換一張傳票（source_ref = note_id:seq:action，天然不重複）
  v_entry := secure_auto_post_voucher(
    'note_transition',
    CASE p_note_kind WHEN 'receivable' THEN 'finance.note_receivable' ELSE 'finance.note_payable' END,
    p_note_id::TEXT || ':' || v_seq || ':' || p_action,
    p_payload || jsonb_build_object(
      '_template', v_template,
      'amount', v_amount,
      'description', COALESCE(NULLIF(p_payload->>'description', ''), v_label),
      'created_by', v_actor
    )
  );

  IF p_note_kind = 'receivable' THEN
    UPDATE notes_receivable
       SET status = v_to,
           transition_seq = v_seq,
           journal_entry_id = COALESCE(v_entry.id, journal_entry_id),
           memo = COALESCE(NULLIF(p_payload->>'memo', ''), memo),
           updated_at = now()
     WHERE id = p_note_id
     RETURNING * INTO v_ar;
    RETURN to_jsonb(v_ar);
  ELSE
    UPDATE notes_payable
       SET status = v_to,
           transition_seq = v_seq,
           journal_entry_id = COALESCE(v_entry.id, journal_entry_id),
           memo = COALESCE(NULLIF(p_payload->>'memo', ''), memo),
           updated_at = now()
     WHERE id = p_note_id
     RETURNING * INTO v_ap;
    RETURN to_jsonb(v_ap);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.secure_register_note(TEXT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_register_note(TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.secure_transition_note(TEXT, UUID, TEXT, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_transition_note(TEXT, UUID, TEXT, JSONB) FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
