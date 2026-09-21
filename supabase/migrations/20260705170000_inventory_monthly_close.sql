-- ════════════════════════════════════════════════════════════════════════════
-- F-C1 月加權平均月結成本 + F-C2 盤點盈虧自動轉傳票
-- 2026-07-05
--
-- F-C1：
--   1. inventory_close_runs / inventory_close_lines：月結批次主檔與逐 SKU 明細
--   2. org 層級 costing_mode 設定 — 存 organizations.settings JSONB（既有 org
--      層級設定即走這個欄位，沿用模式）：'moving_average'（預設，現行即時
--      成本層行為）| 'monthly_weighted_average'（月加權平均月結）
--   3. inventory_cost_layers 補 quantity_received（原始進貨量；quantity_remaining
--      會被出庫消耗遞減，月結需要「本期進貨量」原值）— BEFORE INSERT trigger
--      預設帶 quantity_remaining，不動 addCostLayer 程式
--   4. RPC secure_run_inventory_close(p_period, p_confirm)：
--      draft  → 逐 SKU×倉 計算月加權單價 =（期初值＋本期進貨值含 landed cost）
--               ÷（期初量＋進貨量），重算本期全部出庫成本，寫 run + lines
--      confirm→ 只允許由 draft 確認；差額經 secure_auto_post_voucher 產一張
--               「銷貨成本調整」傳票（doc_type 'inventory_close'，負差額走
--               'credit' 模板），寫 inventory_valuations 期末快照，鎖定該期
--      已 confirmed 的期間重跑 → 回傳既有 run（冪等，這就是月結鎖定）
--   5. posting_rules 種子：inventory_close default（借 5100 銷貨成本／貸 1150
--      存貨）與 credit（反向）；科目 5100 補種
--
-- F-C2：
--   6. stock_counts 補 organization_id / variance_amount / posted_at /
--      journal_refs（盤點狀態機：盤點中 → 已核對 → 已調帳）
--   7. RPC secure_post_stock_count(p_count_id)：僅 status='已核對' 可過帳；
--      自 items JSONB 導出逐品項差異 → 寫 inventory_adjustments（reason '盤差'）
--      → 同步 stock_levels / 成本層 → 經 secure_auto_post_voucher 拋
--      'inventory_count' 傳票（淨盤虧走 default、淨盤盈走 overage 模板；
--      同時有盈有虧則拆兩張，source_ref 加 ':loss'/':gain' 後綴）
--      冪等：journal_entries (org, source_type, source_ref) 唯一鍵 + 狀態守門
--
-- 資料來源備註（與現行 schema 對齊，不虛構欄位）：
--   - 本期進貨：inventory_cost_layers.receipt_date 落在期間的成本層
--     （landed_costs 依 by_value / by_qty 分攤進 receipt_value）
--   - 本期出庫：inventory_transactions type='OUT'（sku 以 code 對 skus、
--     warehouse 以名稱對 warehouses — legacy 欄位型別如此）
--   - 期初：優先取上期已確認月結的期末結轉；無上期月結時以期前成本層
--     剩餘量近似（首期啟用時的過渡）
--
-- idempotent。依賴既有 helper：current_employee_org() / org_visible() 與
-- 20260705100000 的 posting_rules / secure_auto_post_voucher。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. inventory_close_runs / inventory_close_lines ────────────────────────

CREATE TABLE IF NOT EXISTS inventory_close_runs (
  id               BIGSERIAL   PRIMARY KEY,
  organization_id  BIGINT      NOT NULL REFERENCES organizations(id),
  period           TEXT        NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status           TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  total_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0,
  journal_entry_id BIGINT      REFERENCES journal_entries(id),
  executed_by      TEXT,
  executed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, period)
);

CREATE TABLE IF NOT EXISTS inventory_close_lines (
  id                    BIGSERIAL PRIMARY KEY,
  run_id                BIGINT NOT NULL REFERENCES inventory_close_runs(id) ON DELETE CASCADE,
  sku_id                INT    REFERENCES skus(id),
  warehouse_id          INT    REFERENCES warehouses(id),
  opening_qty           NUMERIC(14,4) NOT NULL DEFAULT 0,
  opening_value         NUMERIC(14,2) NOT NULL DEFAULT 0,
  receipt_qty           NUMERIC(14,4) NOT NULL DEFAULT 0,
  receipt_value         NUMERIC(14,2) NOT NULL DEFAULT 0,  -- 含 landed cost 分攤
  monthly_avg_cost      NUMERIC(14,4) NOT NULL DEFAULT 0,
  issued_qty            NUMERIC(14,4) NOT NULL DEFAULT 0,
  issued_value_recalc   NUMERIC(14,2) NOT NULL DEFAULT 0,
  issued_value_original NUMERIC(14,2) NOT NULL DEFAULT 0,
  adjustment            NUMERIC(14,2) NOT NULL DEFAULT 0,  -- = recalc − original
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_close_lines_run ON inventory_close_lines(run_id);
CREATE INDEX IF NOT EXISTS idx_inv_close_runs_org_period ON inventory_close_runs(organization_id, period);

ALTER TABLE inventory_close_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_close_lines ENABLE ROW LEVEL SECURITY;

-- 讀：本組織可見；寫：一律走 SECURITY DEFINER RPC，不開直寫 policy
DROP POLICY IF EXISTS inv_close_runs_sel ON inventory_close_runs;
CREATE POLICY inv_close_runs_sel ON inventory_close_runs
  FOR SELECT USING (org_visible(organization_id));

DROP POLICY IF EXISTS inv_close_lines_sel ON inventory_close_lines;
CREATE POLICY inv_close_lines_sel ON inventory_close_lines
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM inventory_close_runs r
    WHERE r.id = inventory_close_lines.run_id AND org_visible(r.organization_id)
  ));

-- ─── 2. org 層級 costing_mode（organizations.settings JSONB，沿用既有模式）───

UPDATE organizations
SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{costing_mode}', '"moving_average"'::jsonb)
WHERE COALESCE(settings->>'costing_mode', '') = '';

-- ─── 3. inventory_cost_layers.quantity_received（原始進貨量）─────────────────

ALTER TABLE inventory_cost_layers
  ADD COLUMN IF NOT EXISTS quantity_received NUMERIC(14,4);

-- 既有列：以剩餘量近似回填（歷史消耗無從還原，首月啟用後即為精確值）
UPDATE inventory_cost_layers
SET quantity_received = quantity_remaining
WHERE quantity_received IS NULL;

CREATE OR REPLACE FUNCTION public.cost_layers_default_qty_received()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quantity_received IS NULL THEN
    NEW.quantity_received := NEW.quantity_remaining;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cost_layers_qty_received ON inventory_cost_layers;
CREATE TRIGGER trg_cost_layers_qty_received
  BEFORE INSERT ON inventory_cost_layers
  FOR EACH ROW EXECUTE FUNCTION public.cost_layers_default_qty_received();

-- ─── 4. inventory_valuations / stock_counts 補欄 ─────────────────────────────

ALTER TABLE inventory_valuations
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id);

ALTER TABLE stock_counts
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id),
  ADD COLUMN IF NOT EXISTS variance_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS posted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS journal_refs    JSONB DEFAULT '[]'::jsonb;

-- ─── 5. 科目 5100 銷貨成本補種（對齊 constants.js CHART_OF_ACCOUNTS）──────────

INSERT INTO accounts (code, name, type, description, organization_id)
SELECT '5100', '銷貨成本', '銷貨成本', '本期銷貨成本（月結調整用）', o.id
FROM organizations o
ON CONFLICT (code, organization_id) DO NOTHING;

-- ─── 6. posting_rules 種子：inventory_close（default / credit 兩模板）─────────
-- adjustment > 0（重算成本高於原出庫成本 → 補提銷貨成本）：借 5100 / 貸 1150
-- adjustment < 0：走 'credit' 反向模板（payload {_template:'credit'}）

INSERT INTO posting_rules (organization_id, doc_type, template_name, lines) VALUES
(NULL, 'inventory_close', 'default', '[
  {"account_code":"5100","account_name":"銷貨成本","side":"debit","amount_expr":"amount","cost_center_from":"warehouse_id"},
  {"account_code":"1150","account_name":"存貨","side":"credit","amount_expr":"amount","cost_center_from":"warehouse_id"}
]'::jsonb),
(NULL, 'inventory_close', 'credit', '[
  {"account_code":"1150","account_name":"存貨","side":"debit","amount_expr":"amount","cost_center_from":"warehouse_id"},
  {"account_code":"5100","account_name":"銷貨成本","side":"credit","amount_expr":"amount","cost_center_from":"warehouse_id"}
]'::jsonb)
ON CONFLICT (doc_type, template_name) WHERE organization_id IS NULL DO NOTHING;

-- ─── 7. RPC secure_run_inventory_close ──────────────────────────────────────
-- p_confirm=false（試算）：重算並覆寫該期 draft run + lines，回傳明細
-- p_confirm=true （確認）：僅允許由 draft 確認 → 拋一張調整傳票 + 寫期末快照
-- 已 confirmed → 一律回傳既有 run（冪等；即月結鎖定：不再重算、不再入帳）

CREATE OR REPLACE FUNCTION public.secure_run_inventory_close(
  p_period  TEXT,
  p_confirm BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org        INT;
  v_start      DATE;
  v_end        DATE;
  v_prev       TEXT;
  v_has_prev   BOOLEAN;
  v_run        inventory_close_runs;
  v_entry      journal_entries;
  v_total      NUMERIC;
  v_voucher_no TEXT;
  v_snapshots  INT := 0;
  v_actor      TEXT;
  v_lines_json JSONB;
BEGIN
  v_org := current_employee_org();
  IF v_org IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_period IS NULL OR p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '期間格式錯誤：%（應為 YYYY-MM）', COALESCE(p_period, '(null)');
  END IF;

  v_start := (p_period || '-01')::date;
  v_end   := (v_start + interval '1 month' - interval '1 day')::date;
  v_prev  := to_char(v_start - interval '1 month', 'YYYY-MM');

  SELECT name INTO v_actor FROM employees
   WHERE auth_user_id = auth.uid()
      OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
   ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST
   LIMIT 1;
  v_actor := COALESCE(v_actor, '系統(月結)');

  SELECT * INTO v_run FROM inventory_close_runs
   WHERE organization_id = v_org AND period = p_period
   FOR UPDATE;

  -- 已確認的期間 → 鎖定：不重算不重拋，回傳既有結果（冪等）
  IF FOUND AND v_run.status = 'confirmed' THEN
    SELECT entry_number INTO v_voucher_no FROM journal_entries WHERE id = v_run.journal_entry_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', cl.id, 'sku_id', cl.sku_id, 'sku_code', s.code, 'sku_name', s.name,
             'warehouse_id', cl.warehouse_id, 'warehouse_name', w.name,
             'opening_qty', cl.opening_qty, 'opening_value', cl.opening_value,
             'receipt_qty', cl.receipt_qty, 'receipt_value', cl.receipt_value,
             'monthly_avg_cost', cl.monthly_avg_cost, 'issued_qty', cl.issued_qty,
             'issued_value_recalc', cl.issued_value_recalc,
             'issued_value_original', cl.issued_value_original,
             'adjustment', cl.adjustment) ORDER BY s.code), '[]'::jsonb)
      INTO v_lines_json
      FROM inventory_close_lines cl
      LEFT JOIN skus s ON s.id = cl.sku_id
      LEFT JOIN warehouses w ON w.id = cl.warehouse_id
     WHERE cl.run_id = v_run.id;
    RETURN jsonb_build_object(
      'run', to_jsonb(v_run), 'lines', v_lines_json,
      'voucher_number', v_voucher_no, 'already_confirmed', true);
  END IF;

  -- ── confirm：只允許由既有 draft 確認 ──────────────────────────────────────
  IF p_confirm THEN
    IF v_run.id IS NULL THEN
      RAISE EXCEPTION '期間 % 尚未試算，請先執行試算再確認月結', p_period;
    END IF;

    v_total := COALESCE((SELECT SUM(adjustment) FROM inventory_close_lines WHERE run_id = v_run.id), 0);
    v_total := round(v_total, 2);

    IF v_total <> 0 THEN
      v_entry := secure_auto_post_voucher(
        'inventory_close',
        'inventory_close_run',
        v_run.id::text,
        jsonb_build_object(
          'amount',      abs(v_total),
          '_template',   CASE WHEN v_total < 0 THEN 'credit' ELSE 'default' END,
          'entry_date',  to_char(v_end, 'YYYY-MM-DD'),
          'description', p_period || ' 存貨月結成本調整（月加權平均）'
        ));
      IF v_entry.id IS NOT NULL THEN
        v_voucher_no := v_entry.entry_number;
      END IF;
    END IF;

    -- 期末快照（營業成本表取數來源）：同期同法先清後寫，冪等
    DELETE FROM inventory_valuations
     WHERE valuation_date = v_end
       AND costing_method = 'monthly_weighted_average'
       AND organization_id = v_org;

    INSERT INTO inventory_valuations
      (sku_id, valuation_date, costing_method, total_quantity, total_value, unit_cost, organization_id)
    SELECT cl.sku_id, v_end, 'monthly_weighted_average',
           round(SUM(cl.opening_qty + cl.receipt_qty - cl.issued_qty), 4),
           round(SUM(cl.opening_value + cl.receipt_value - cl.issued_value_recalc), 2),
           CASE WHEN SUM(cl.opening_qty + cl.receipt_qty - cl.issued_qty) > 0
                THEN round(SUM(cl.opening_value + cl.receipt_value - cl.issued_value_recalc)
                           / SUM(cl.opening_qty + cl.receipt_qty - cl.issued_qty), 4)
                ELSE 0 END,
           v_org
      FROM inventory_close_lines cl
     WHERE cl.run_id = v_run.id AND cl.sku_id IS NOT NULL
     GROUP BY cl.sku_id;
    GET DIAGNOSTICS v_snapshots = ROW_COUNT;

    UPDATE inventory_close_runs
       SET status = 'confirmed',
           total_adjustment = v_total,
           journal_entry_id = COALESCE(v_entry.id, journal_entry_id),
           executed_by = v_actor,
           executed_at = now(),
           updated_at = now()
     WHERE id = v_run.id
     RETURNING * INTO v_run;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', cl.id, 'sku_id', cl.sku_id, 'sku_code', s.code, 'sku_name', s.name,
             'warehouse_id', cl.warehouse_id, 'warehouse_name', w.name,
             'opening_qty', cl.opening_qty, 'opening_value', cl.opening_value,
             'receipt_qty', cl.receipt_qty, 'receipt_value', cl.receipt_value,
             'monthly_avg_cost', cl.monthly_avg_cost, 'issued_qty', cl.issued_qty,
             'issued_value_recalc', cl.issued_value_recalc,
             'issued_value_original', cl.issued_value_original,
             'adjustment', cl.adjustment) ORDER BY s.code), '[]'::jsonb)
      INTO v_lines_json
      FROM inventory_close_lines cl
      LEFT JOIN skus s ON s.id = cl.sku_id
      LEFT JOIN warehouses w ON w.id = cl.warehouse_id
     WHERE cl.run_id = v_run.id;

    RETURN jsonb_build_object(
      'run', to_jsonb(v_run), 'lines', v_lines_json,
      'voucher_number', v_voucher_no, 'snapshot_count', v_snapshots,
      'already_confirmed', false);
  END IF;

  -- ── draft：重算並覆寫 ────────────────────────────────────────────────────
  IF v_run.id IS NULL THEN
    INSERT INTO inventory_close_runs (organization_id, period, status)
    VALUES (v_org, p_period, 'draft')
    RETURNING * INTO v_run;
  END IF;

  DELETE FROM inventory_close_lines WHERE run_id = v_run.id;

  v_has_prev := EXISTS (
    SELECT 1 FROM inventory_close_runs
    WHERE organization_id = v_org AND period = v_prev AND status = 'confirmed');

  INSERT INTO inventory_close_lines
    (run_id, sku_id, warehouse_id, opening_qty, opening_value, receipt_qty, receipt_value,
     monthly_avg_cost, issued_qty, issued_value_recalc, issued_value_original, adjustment)
  SELECT v_run.id, m.sku_id, m.warehouse_id,
         round(m.opening_qty, 4), round(m.opening_value, 2),
         round(m.receipt_qty, 4), round(m.receipt_value, 2),
         round(x.avg_cost, 4),
         round(m.issued_qty, 4),
         round(m.issued_qty * x.avg_cost, 2),
         round(m.issued_value_original, 2),
         round(m.issued_qty * x.avg_cost, 2) - round(m.issued_value_original, 2)
  FROM (
    WITH receipt_layers AS (
      -- 本期進貨成本層（quantity_received = 原始進貨量）
      SELECT l.sku_id, l.warehouse_id, l.source_type, l.source_id,
             COALESCE(l.quantity_received, l.quantity_remaining) AS qty,
             l.unit_cost
      FROM inventory_cost_layers l
      WHERE l.receipt_date >= v_start AND l.receipt_date <= v_end
        AND (l.organization_id IS NULL OR l.organization_id = v_org)
    ),
    order_totals AS (
      SELECT source_id,
             SUM(qty * unit_cost) AS order_value,
             SUM(qty)             AS order_qty
      FROM receipt_layers
      WHERE source_type = 'purchase' AND source_id IS NOT NULL
      GROUP BY source_id
    ),
    landed AS (
      -- 進貨費用（運費/關稅/保險）依 by_value / by_qty 分攤進本期進貨值
      SELECT inbound_order_id,
             COALESCE(SUM(amount) FILTER (WHERE allocation_method = 'by_value'), 0)  AS amt_by_value,
             COALESCE(SUM(amount) FILTER (WHERE allocation_method <> 'by_value'), 0) AS amt_by_qty
      FROM landed_costs
      WHERE organization_id IS NULL OR organization_id = v_org
      GROUP BY inbound_order_id
    ),
    receipts AS (
      SELECT r.sku_id, r.warehouse_id,
             SUM(r.qty) AS receipt_qty,
             SUM(r.qty * r.unit_cost
               + CASE WHEN r.source_type = 'purchase' AND ld.inbound_order_id IS NOT NULL THEN
                   ld.amt_by_value * CASE WHEN ot.order_value > 0 THEN (r.qty * r.unit_cost) / ot.order_value ELSE 0 END
                 + ld.amt_by_qty   * CASE WHEN ot.order_qty  > 0 THEN r.qty / ot.order_qty ELSE 0 END
                 ELSE 0 END
             ) AS receipt_value
      FROM receipt_layers r
      LEFT JOIN order_totals ot ON r.source_type = 'purchase' AND ot.source_id = r.source_id
      LEFT JOIN landed ld       ON r.source_type = 'purchase' AND ld.inbound_order_id = r.source_id
      GROUP BY r.sku_id, r.warehouse_id
    ),
    opening AS (
      -- 上期已確認月結 → 期末結轉；否則以期前成本層剩餘近似（首期過渡）
      SELECT cl.sku_id, cl.warehouse_id,
             SUM(cl.opening_qty + cl.receipt_qty - cl.issued_qty)              AS qty,
             SUM(cl.opening_value + cl.receipt_value - cl.issued_value_recalc) AS value
      FROM inventory_close_lines cl
      JOIN inventory_close_runs cr ON cr.id = cl.run_id
      WHERE v_has_prev
        AND cr.organization_id = v_org AND cr.period = v_prev AND cr.status = 'confirmed'
      GROUP BY cl.sku_id, cl.warehouse_id
      UNION ALL
      SELECT l.sku_id, l.warehouse_id,
             SUM(l.quantity_remaining),
             SUM(l.quantity_remaining * l.unit_cost)
      FROM inventory_cost_layers l
      WHERE NOT v_has_prev
        AND l.receipt_date < v_start AND l.quantity_remaining > 0
        AND (l.organization_id IS NULL OR l.organization_id = v_org)
      GROUP BY l.sku_id, l.warehouse_id
    ),
    issues AS (
      -- 本期出庫（銷貨/調撥/領用）：legacy 異動帳 sku=code、warehouse=名稱
      SELECT s.id AS sku_id, w.id AS warehouse_id,
             SUM(t.qty)                            AS issued_qty,
             SUM(t.qty * COALESCE(t.unit_cost, 0)) AS issued_value_original
      FROM inventory_transactions t
      JOIN skus s        ON s.code = t.sku
      LEFT JOIN warehouses w ON w.name = t.warehouse
      WHERE t.type = 'OUT' AND t.date >= v_start AND t.date <= v_end
      GROUP BY s.id, w.id
    )
    SELECT sku_id, warehouse_id,
           SUM(opening_qty)           AS opening_qty,
           SUM(opening_value)         AS opening_value,
           SUM(receipt_qty)           AS receipt_qty,
           SUM(receipt_value)         AS receipt_value,
           SUM(issued_qty)            AS issued_qty,
           SUM(issued_value_original) AS issued_value_original
    FROM (
      SELECT sku_id, warehouse_id, qty AS opening_qty, value AS opening_value,
             0::numeric AS receipt_qty, 0::numeric AS receipt_value,
             0::numeric AS issued_qty, 0::numeric AS issued_value_original
      FROM opening
      UNION ALL
      SELECT sku_id, warehouse_id, 0, 0, receipt_qty, receipt_value, 0, 0 FROM receipts
      UNION ALL
      SELECT sku_id, warehouse_id, 0, 0, 0, 0, issued_qty, issued_value_original FROM issues
    ) u
    GROUP BY sku_id, warehouse_id
  ) m
  CROSS JOIN LATERAL (
    -- 月加權單價；分母為 0 → 沿用最近成本（剩餘成本層加權平均 → skus.unit_cost）
    SELECT CASE
      WHEN (m.opening_qty + m.receipt_qty) > 0
        THEN (m.opening_value + m.receipt_value) / (m.opening_qty + m.receipt_qty)
      ELSE COALESCE(
        (SELECT SUM(l2.quantity_remaining * l2.unit_cost) / NULLIF(SUM(l2.quantity_remaining), 0)
           FROM inventory_cost_layers l2
          WHERE l2.sku_id = m.sku_id
            AND (m.warehouse_id IS NULL OR l2.warehouse_id = m.warehouse_id)
            AND l2.quantity_remaining > 0),
        (SELECT s2.unit_cost FROM skus s2 WHERE s2.id = m.sku_id),
        0)
      END AS avg_cost
  ) x
  WHERE m.sku_id IS NOT NULL
    AND (m.opening_qty <> 0 OR m.receipt_qty <> 0 OR m.issued_qty <> 0
         OR m.opening_value <> 0 OR m.receipt_value <> 0);

  UPDATE inventory_close_runs
     SET total_adjustment = COALESCE(
           (SELECT round(SUM(adjustment), 2) FROM inventory_close_lines WHERE run_id = v_run.id), 0),
         status = 'draft',
         updated_at = now()
   WHERE id = v_run.id
   RETURNING * INTO v_run;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', cl.id, 'sku_id', cl.sku_id, 'sku_code', s.code, 'sku_name', s.name,
           'warehouse_id', cl.warehouse_id, 'warehouse_name', w.name,
           'opening_qty', cl.opening_qty, 'opening_value', cl.opening_value,
           'receipt_qty', cl.receipt_qty, 'receipt_value', cl.receipt_value,
           'monthly_avg_cost', cl.monthly_avg_cost, 'issued_qty', cl.issued_qty,
           'issued_value_recalc', cl.issued_value_recalc,
           'issued_value_original', cl.issued_value_original,
           'adjustment', cl.adjustment) ORDER BY s.code), '[]'::jsonb)
    INTO v_lines_json
    FROM inventory_close_lines cl
    LEFT JOIN skus s ON s.id = cl.sku_id
    LEFT JOIN warehouses w ON w.id = cl.warehouse_id
   WHERE cl.run_id = v_run.id;

  RETURN jsonb_build_object(
    'run', to_jsonb(v_run), 'lines', v_lines_json,
    'voucher_number', NULL, 'already_confirmed', false);
END $$;

GRANT EXECUTE ON FUNCTION public.secure_run_inventory_close(TEXT, BOOLEAN) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_run_inventory_close(TEXT, BOOLEAN) FROM anon;

-- ─── 8. RPC secure_post_stock_count（F-C2 已核對 → 已調帳）───────────────────

CREATE OR REPLACE FUNCTION public.secure_post_stock_count(p_count_id INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org      INT;
  v_count    stock_counts;
  v_wh_id    INT;
  v_item     JSONB;
  v_sku      TEXT;
  v_name     TEXT;
  v_sys      NUMERIC;
  v_cnt      NUMERIC;
  v_var      NUMERIC;
  v_cost     NUMERIC;
  v_short    NUMERIC := 0;  -- 盤虧總額（正數）
  v_over     NUMERIC := 0;  -- 盤盈總額（正數）
  v_remain   NUMERIC;
  v_used     NUMERIC;
  v_layer    RECORD;
  v_entry    journal_entries;
  v_vouchers JSONB := '[]'::jsonb;
  v_adj_cnt  INT := 0;
  v_date     TEXT;
BEGIN
  v_org := current_employee_org();
  IF v_org IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  SELECT * INTO v_count FROM stock_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '找不到盤點單 #%', p_count_id; END IF;

  -- 冪等：已調帳 → 回傳既有結果，不重複入帳
  IF v_count.status = '已調帳' THEN
    RETURN jsonb_build_object(
      'count_id', v_count.id, 'already_posted', true,
      'variance_amount', v_count.variance_amount,
      'vouchers', COALESCE(v_count.journal_refs, '[]'::jsonb));
  END IF;

  IF v_count.status <> '已核對' THEN
    RAISE EXCEPTION '僅「已核對」狀態的盤點單可執行調帳過帳（目前狀態：%）', v_count.status;
  END IF;

  IF v_count.items IS NULL OR jsonb_typeof(v_count.items) <> 'array'
     OR jsonb_array_length(v_count.items) = 0 THEN
    RAISE EXCEPTION '盤點單 #% 無盤點明細（items 為空），無法調帳', p_count_id;
  END IF;

  SELECT id INTO v_wh_id FROM warehouses WHERE name = v_count.warehouse LIMIT 1;
  v_date := to_char(COALESCE(v_count.count_date, CURRENT_DATE), 'YYYY-MM-DD');

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_count.items) LOOP
    v_sku  := COALESCE(v_item->>'sku', v_item->>'sku_code');
    v_name := COALESCE(v_item->>'name', v_item->>'sku_name', v_sku);
    v_sys  := COALESCE((v_item->>'system_qty')::numeric, 0);
    v_cnt  := COALESCE((v_item->>'counted_qty')::numeric, v_sys);
    v_var  := v_cnt - v_sys;
    CONTINUE WHEN v_sku IS NULL OR v_var = 0;

    -- 單位成本：成本層加權平均（getWeightedAvgCost 的 SQL 等價）→ items.unit_cost → skus.unit_cost
    SELECT SUM(l.quantity_remaining * l.unit_cost) / NULLIF(SUM(l.quantity_remaining), 0)
      INTO v_cost
      FROM inventory_cost_layers l
      JOIN skus s ON s.id = l.sku_id
     WHERE s.code = v_sku AND l.quantity_remaining > 0
       AND (v_wh_id IS NULL OR l.warehouse_id = v_wh_id);
    v_cost := round(COALESCE(v_cost,
                NULLIF(v_item->>'unit_cost', '')::numeric,
                (SELECT unit_cost FROM skus WHERE code = v_sku LIMIT 1),
                0), 4);

    -- 盤差調整（audit）
    INSERT INTO inventory_adjustments
      (sku_code, sku_name, quantity, reason, operator, unit_cost, organization_id)
    VALUES
      (v_sku, v_name, v_var, '盤差', COALESCE(v_count.counter, '系統'), v_cost, v_org);
    v_adj_cnt := v_adj_cnt + 1;

    -- 庫存帳同步
    UPDATE stock_levels SET quantity = GREATEST(quantity + v_var, 0)
     WHERE sku_code = v_sku AND warehouse = v_count.warehouse;
    IF NOT FOUND AND v_var > 0 THEN
      INSERT INTO stock_levels (sku_code, warehouse, quantity)
      VALUES (v_sku, v_count.warehouse, v_var);
    END IF;

    -- 成本層同步：盤盈補層（source_type='adjustment'）、盤虧照 FIFO 消耗
    IF v_var > 0 THEN
      INSERT INTO inventory_cost_layers
        (sku_id, warehouse_id, quantity_remaining, quantity_received, unit_cost,
         source_type, source_id, receipt_date, organization_id)
      SELECT s.id, v_wh_id, v_var, v_var, v_cost, 'adjustment', p_count_id,
             COALESCE(v_count.count_date, CURRENT_DATE), v_org
      FROM skus s WHERE s.code = v_sku;
      v_over := v_over + round(v_var * v_cost, 2);
    ELSE
      v_remain := -v_var;
      FOR v_layer IN
        SELECT l.id, l.quantity_remaining
          FROM inventory_cost_layers l
          JOIN skus s ON s.id = l.sku_id
         WHERE s.code = v_sku AND l.quantity_remaining > 0
           AND (v_wh_id IS NULL OR l.warehouse_id = v_wh_id)
         ORDER BY l.receipt_date, l.id
      LOOP
        EXIT WHEN v_remain <= 0;
        v_used := LEAST(v_layer.quantity_remaining, v_remain);
        UPDATE inventory_cost_layers
           SET quantity_remaining = quantity_remaining - v_used
         WHERE id = v_layer.id;
        v_remain := v_remain - v_used;
      END LOOP;
      v_short := v_short + round(-v_var * v_cost, 2);
    END IF;
  END LOOP;

  -- 傳票拋轉：淨盤虧 default（借 存貨盤損／貸 存貨）、淨盤盈 overage（借 存貨／貸 存貨盤盈）
  -- 同時有盈有虧 → 拆兩張，source_ref 加 ':loss' / ':gain' 後綴
  IF v_short > 0 AND v_over > 0 THEN
    v_entry := secure_auto_post_voucher('inventory_count', 'stock_count',
      p_count_id::text || ':loss',
      jsonb_build_object('amount', v_short, 'warehouse_id', v_wh_id,
                         'entry_date', v_date,
                         'description', '盤點盤虧 #' || p_count_id || '（' || COALESCE(v_count.warehouse, '') || '）'));
    IF v_entry.id IS NOT NULL THEN
      v_vouchers := v_vouchers || jsonb_build_object(
        'kind', 'loss', 'amount', v_short,
        'entry_id', v_entry.id, 'entry_number', v_entry.entry_number);
    END IF;

    v_entry := secure_auto_post_voucher('inventory_count', 'stock_count',
      p_count_id::text || ':gain',
      jsonb_build_object('amount', v_over, '_template', 'overage', 'warehouse_id', v_wh_id,
                         'entry_date', v_date,
                         'description', '盤點盤盈 #' || p_count_id || '（' || COALESCE(v_count.warehouse, '') || '）'));
    IF v_entry.id IS NOT NULL THEN
      v_vouchers := v_vouchers || jsonb_build_object(
        'kind', 'gain', 'amount', v_over,
        'entry_id', v_entry.id, 'entry_number', v_entry.entry_number);
    END IF;
  ELSIF v_short > 0 THEN
    v_entry := secure_auto_post_voucher('inventory_count', 'stock_count',
      p_count_id::text,
      jsonb_build_object('amount', v_short, 'warehouse_id', v_wh_id,
                         'entry_date', v_date,
                         'description', '盤點盤虧 #' || p_count_id || '（' || COALESCE(v_count.warehouse, '') || '）'));
    IF v_entry.id IS NOT NULL THEN
      v_vouchers := v_vouchers || jsonb_build_object(
        'kind', 'loss', 'amount', v_short,
        'entry_id', v_entry.id, 'entry_number', v_entry.entry_number);
    END IF;
  ELSIF v_over > 0 THEN
    v_entry := secure_auto_post_voucher('inventory_count', 'stock_count',
      p_count_id::text,
      jsonb_build_object('amount', v_over, '_template', 'overage', 'warehouse_id', v_wh_id,
                         'entry_date', v_date,
                         'description', '盤點盤盈 #' || p_count_id || '（' || COALESCE(v_count.warehouse, '') || '）'));
    IF v_entry.id IS NOT NULL THEN
      v_vouchers := v_vouchers || jsonb_build_object(
        'kind', 'gain', 'amount', v_over,
        'entry_id', v_entry.id, 'entry_number', v_entry.entry_number);
    END IF;
  END IF;

  UPDATE stock_counts
     SET status = '已調帳',
         organization_id = COALESCE(organization_id, v_org),
         variance_amount = round(v_over - v_short, 2),
         discrepancies   = v_adj_cnt,
         posted_at       = now(),
         journal_refs    = v_vouchers
   WHERE id = p_count_id;

  RETURN jsonb_build_object(
    'count_id', p_count_id, 'already_posted', false,
    'shortage_total', v_short, 'overage_total', v_over,
    'variance_amount', round(v_over - v_short, 2),
    'adjustments', v_adj_cnt, 'vouchers', v_vouchers);
END $$;

GRANT EXECUTE ON FUNCTION public.secure_post_stock_count(INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_post_stock_count(INT) FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
