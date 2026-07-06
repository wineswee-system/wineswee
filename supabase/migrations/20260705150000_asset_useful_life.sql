-- ════════════════════════════════════════════════════════════════════════════
-- F-A5 固定資產對齊稅法 + 折舊自動提列
-- 2026-07-05
--
-- 1. asset_useful_life_table：行政院「固定資產耐用年數表」參考種子（全域唯讀）
-- 2. fixed_assets：補建（歷史上只存在於 archive schema，未入 migration）＋
--    organization_id / useful_life_ref_id / life_override_reason / 處分欄位
-- 3. depreciation_runs / depreciation_run_lines：月折舊提列批次（org+period 冪等）
-- 4. RPC secure_run_monthly_depreciation(p_period)：逐資產計提（平均法/定率遞減/
--    年數合計，公式忠實移植 src/lib/accounting/depreciation.js）→ 寫 run+lines →
--    經 secure_auto_post_voucher('depreciation_monthly', 'depreciation_run', run_id,
--    jsonb{amount:total}) 產一張彙總傳票（借 6300 折舊費用 / 貸 1610 累計折舊，
--    模板已由 20260705100000 種子）
-- 5. RPC secure_dispose_fixed_asset：出售/報廢 → 沖銷成本與累計折舊、認列處分
--    損益，經 doc_type 'asset_disposal' 拋轉（模板本檔種子）
--
-- 科目註記：處分模板用 7150 處分固定資產利益 / 7500 處分固定資產損失、1600 固定
-- 資產、1100 現金 — 7150/7500/1600 未在 accounts 種子（20260416200004）中，
-- secure_auto_post_voucher 會回落模板行內 account_name，不會失敗。
--
-- idempotent。依賴既有 helper：current_employee_org() / org_visible() /
-- set_org_default()（20260618100000 起）、secure_auto_post_voucher（20260705100000）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. asset_useful_life_table（行政院固定資產耐用年數表）───────────────────

CREATE TABLE IF NOT EXISTS public.asset_useful_life_table (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category          TEXT NOT NULL,
  item_name         TEXT NOT NULL,
  useful_life_years INT  NOT NULL CHECK (useful_life_years > 0),
  source_ref        TEXT NOT NULL DEFAULT '行政院固定資產耐用年數表',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category, item_name)
);

ALTER TABLE public.asset_useful_life_table ENABLE ROW LEVEL SECURITY;

-- 全國一致的參考表：登入者皆可讀，寫入僅 service role / migration
DROP POLICY IF EXISTS asset_useful_life_sel ON public.asset_useful_life_table;
CREATE POLICY asset_useful_life_sel ON public.asset_useful_life_table
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS asset_useful_life_service ON public.asset_useful_life_table;
CREATE POLICY asset_useful_life_service ON public.asset_useful_life_table
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 種子：常見 F&B / 零售資產（年限依行政院固定資產耐用年數表；
-- 表上無對應細目、以實務慣用歸類者以「近似值」註記）
INSERT INTO public.asset_useful_life_table (category, item_name, useful_life_years) VALUES
  -- 房屋建築
  ('房屋建築',   '鋼筋（骨）混凝土建造',       50),
  ('房屋建築',   '加強磚造',                   35),
  ('房屋建築',   '磚構造',                     25),
  ('房屋建築',   '木造',                       10),
  -- 房屋附屬設備
  ('房屋附屬設備', '電梯（升降機設備）',        15),  -- 近似值
  ('房屋附屬設備', '中央系統冷暖氣設備',        15),  -- 近似值
  ('房屋附屬設備', '給水排水衛生設備',          15),  -- 近似值
  ('房屋附屬設備', '室內裝修（裝潢工程）',       5),  -- 近似值（實務多按租期或 5 年攤提）
  -- 辦公設備
  ('辦公設備',   '事務機器（影印/傳真機）',     5),
  ('辦公設備',   '電子計算機（電腦及週邊）',    3),
  ('辦公設備',   '傢俱（桌椅櫥櫃）',            5),
  ('辦公設備',   '通訊器材（電話/總機）',       5),  -- 近似值
  -- 運輸設備
  ('運輸設備',   '自用小客車',                  5),
  ('運輸設備',   '載貨汽車（其他業用）',        5),
  ('運輸設備',   '載貨汽車（運輸業用）',        4),
  ('運輸設備',   '機車',                        3),
  -- 機械設備
  ('機械設備',   '食品及飲料加工設備',          8),  -- 近似值（食品製造設備類）
  ('機械設備',   '冷凍冷藏設備',                8),  -- 近似值
  ('機械設備',   '烘焙設備（烤箱/攪拌機）',     7),  -- 近似值
  ('機械設備',   '商用咖啡機',                  5),  -- 近似值
  ('機械設備',   '商用洗碗機',                  7),  -- 近似值
  -- 什項設備
  ('什項設備',   '廚房設備（爐具/排油煙）',     7),  -- 近似值
  ('什項設備',   '生財器具（貨架/展示櫃）',     5),  -- 近似值
  ('什項設備',   'POS 收銀設備',                3),  -- 比照電子計算機（近似值）
  ('什項設備',   '監視安全系統',                5),  -- 近似值
  ('什項設備',   '招牌廣告塔',                  5)   -- 近似值
ON CONFLICT (category, item_name) DO UPDATE SET
  useful_life_years = EXCLUDED.useful_life_years,
  source_ref        = EXCLUDED.source_ref;

-- ─── 2. fixed_assets ─────────────────────────────────────────────────────────
-- 註：fixed_assets 只存在於 ARCHIVE_DO_NOT_USE_supabase-schema.sql（含 tenant_id
-- INT），從未入 migration → 先補建（既有環境 IF NOT EXISTS 跳過），再補欄位。
-- 既有部署若已有 organization_id（app 層 db/finance.js 早已依此過濾），
-- ADD COLUMN IF NOT EXISTS 會自動跳過、不動原型別。

CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id            SERIAL PRIMARY KEY,
  asset_code    TEXT UNIQUE,
  name          TEXT NOT NULL,
  category      TEXT DEFAULT '辦公設備',   -- 土地/建築物/機器設備/運輸設備/辦公設備/其他
  cost          NUMERIC NOT NULL DEFAULT 0,
  salvage_value NUMERIC DEFAULT 0,
  useful_life   INT NOT NULL DEFAULT 5,     -- 年
  method        TEXT DEFAULT 'straight_line', -- straight_line/declining_balance/sum_of_years
  acquired_date DATE DEFAULT current_date,
  disposed_date DATE,
  status        TEXT DEFAULT '使用中',      -- 使用中/已處分/已報廢
  department    TEXT,
  location      TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id);
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS useful_life_ref_id UUID REFERENCES public.asset_useful_life_table(id);
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS life_override_reason TEXT;
-- 處分登錄（secure_dispose_fixed_asset 回寫）
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS disposal_type TEXT;             -- 出售/報廢
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS disposal_proceeds NUMERIC;
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS disposal_gain_loss NUMERIC;     -- 正=利益、負=損失
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS disposal_journal_entry_id BIGINT;

-- 回填單一租戶 org（沿用 20260618110000 慣例）
UPDATE public.fixed_assets
   SET organization_id = (SELECT MIN(id) FROM organizations)
 WHERE organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_fixed_assets_org ON public.fixed_assets(organization_id);

-- 新列自動帶 org（helper 存在才掛，沿用 set_org_default 慣例）
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
    WHERE n.nspname = 'public' AND pr.proname = 'set_org_default'
  ) THEN
    DROP TRIGGER IF EXISTS trg_set_org_default ON public.fixed_assets;
    CREATE TRIGGER trg_set_org_default BEFORE INSERT ON public.fixed_assets
      FOR EACH ROW EXECUTE FUNCTION public.set_org_default();
  END IF;
END $$;

-- RLS：全面清掉歷史 policy（archive 遺留 tenant_isolation_fixed_assets 等），
-- 重建 org-scoped 確定態（沿用 20260618120001 sweep 模式）
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'fixed_assets' LOOP
    EXECUTE format('DROP POLICY %I ON public.fixed_assets', p.policyname);
  END LOOP;
END $$;

CREATE POLICY fixed_assets_org_sel ON public.fixed_assets
  FOR SELECT USING (org_visible(organization_id));
CREATE POLICY fixed_assets_org_ins ON public.fixed_assets
  FOR INSERT WITH CHECK (org_visible(organization_id));
CREATE POLICY fixed_assets_org_upd ON public.fixed_assets
  FOR UPDATE USING (org_visible(organization_id)) WITH CHECK (org_visible(organization_id));
CREATE POLICY fixed_assets_org_del ON public.fixed_assets
  FOR DELETE USING (org_visible(organization_id));
CREATE POLICY fixed_assets_service ON public.fixed_assets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 3. depreciation_runs / depreciation_run_lines ───────────────────────────

CREATE TABLE IF NOT EXISTS public.depreciation_runs (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  BIGINT  NOT NULL REFERENCES organizations(id),
  period           TEXT    NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),  -- 'YYYY-MM'
  status           TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
  total_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
  journal_entry_id BIGINT,                             -- 彙總傳票（journal_entries.id）
  executed_by      TEXT,
  executed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, period)                     -- 同組織同期唯一 → 重跑冪等
);

CREATE TABLE IF NOT EXISTS public.depreciation_run_lines (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  BIGINT  NOT NULL REFERENCES organizations(id),
  run_id           UUID    NOT NULL REFERENCES public.depreciation_runs(id) ON DELETE CASCADE,
  asset_id         BIGINT  NOT NULL REFERENCES public.fixed_assets(id),
  asset_name       TEXT,
  amount           NUMERIC(14,2) NOT NULL,
  journal_entry_id BIGINT                              -- 目前指向 run 的彙總傳票
);

CREATE INDEX IF NOT EXISTS idx_depreciation_runs_org_period
  ON public.depreciation_runs(organization_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_depreciation_run_lines_run
  ON public.depreciation_run_lines(run_id);

-- RLS：讀限同 org；寫一律走 SECURITY DEFINER RPC（不開 authenticated 寫入 policy）
ALTER TABLE public.depreciation_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depreciation_run_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS depreciation_runs_org_sel ON public.depreciation_runs;
CREATE POLICY depreciation_runs_org_sel ON public.depreciation_runs
  FOR SELECT USING (org_visible(organization_id));
DROP POLICY IF EXISTS depreciation_runs_service ON public.depreciation_runs;
CREATE POLICY depreciation_runs_service ON public.depreciation_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS depreciation_run_lines_org_sel ON public.depreciation_run_lines;
CREATE POLICY depreciation_run_lines_org_sel ON public.depreciation_run_lines
  FOR SELECT USING (org_visible(organization_id));
DROP POLICY IF EXISTS depreciation_run_lines_service ON public.depreciation_run_lines;
CREATE POLICY depreciation_run_lines_service ON public.depreciation_run_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 4. posting_rules 種子：asset_disposal（處分傳票模板）───────────────────
-- 借 現金 + 累計折舊 (+ 處分損失) / 貸 固定資產成本 (+ 處分利益)
-- payload 鍵：proceeds / accum / loss / cost / gain（0 元行由引擎自動略過）
-- 註：7150/7500/1600/1100 未必在 accounts 表 → 引擎回落行內 account_name

INSERT INTO posting_rules (organization_id, doc_type, template_name, lines) VALUES
(NULL, 'asset_disposal', 'default', '[
  {"account_code":"1100","account_name":"現金","side":"debit","amount_expr":"proceeds","cost_center_from":""},
  {"account_code":"1610","account_name":"累計折舊","side":"debit","amount_expr":"accum","cost_center_from":""},
  {"account_code":"7500","account_name":"處分固定資產損失","side":"debit","amount_expr":"loss","cost_center_from":"cost_center"},
  {"account_code":"1600","account_name":"固定資產","side":"credit","amount_expr":"cost","cost_center_from":""},
  {"account_code":"7150","account_name":"處分固定資產利益","side":"credit","amount_expr":"gain","cost_center_from":"cost_center"}
]'::jsonb)
ON CONFLICT (doc_type, template_name) WHERE organization_id IS NULL DO NOTHING;

-- ─── 5. 折舊累計函數（忠實移植 src/lib/accounting/depreciation.js）─────────────
-- fa_accumulated_depreciation(cost, salvage, life, method, monthsElapsed)
-- 回傳「經過 p_months 個月」的累計折舊（與 JS calculateDepreciation 的
-- accumulated_depreciation 完全同式：含 round(…,2) 的逐年/逐月四捨五入與封頂）。
-- 單月提列金額 = A(d+1) − A(d)（見 secure_run_monthly_depreciation）。

CREATE OR REPLACE FUNCTION public.fa_accumulated_depreciation(
  p_cost    NUMERIC,
  p_salvage NUMERIC,
  p_life    INT,
  p_method  TEXT,
  p_months  INT
) RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_method       TEXT    := COALESCE(NULLIF(p_method, ''), 'straight_line');
  v_salvage      NUMERIC := COALESCE(p_salvage, 0);
  v_depreciable  NUMERIC := p_cost - COALESCE(p_salvage, 0);
  v_months       INT     := GREATEST(COALESCE(p_months, 0), 0);
  v_total_months INT;
  v_capped       INT;
  v_current_year INT;
  v_monthly      NUMERIC;
  v_accum        NUMERIC := 0;
  v_rate         NUMERIC;
  v_remaining    NUMERIC;
  v_yearly       NUMERIC;
  v_monthly_dep  NUMERIC;
  v_months_in_yr INT;
  v_sum_years    NUMERIC;
  v_year         INT;
BEGIN
  IF p_life IS NULL OR p_life <= 0 THEN RAISE EXCEPTION '耐用年數必須大於 0'; END IF;
  v_total_months := p_life * 12;
  v_capped       := LEAST(v_months, v_total_months);
  v_current_year := LEAST(FLOOR(v_months / 12.0)::INT + 1, p_life);

  IF v_method = 'straight_line' THEN
    -- 直線法（平均法）：每月折舊 = 可折舊金額 / 總月數
    v_monthly := ROUND(v_depreciable / v_total_months, 2);
    v_accum   := ROUND(v_monthly * v_capped, 2);

  ELSIF v_method = 'declining_balance' THEN
    -- 定率遞減法：折舊率 = 1 - (殘值/成本)^(1/耐用年限)；無殘值 → 雙倍餘額遞減
    IF v_salvage > 0 THEN
      v_rate := 1 - POWER(v_salvage / p_cost, 1.0 / p_life);
    ELSE
      v_rate := 2.0 / p_life;
    END IF;
    v_remaining := p_cost;
    FOR v_year IN 1..LEAST(v_current_year, p_life) LOOP
      IF v_year < v_current_year THEN v_months_in_yr := 12;
      ELSE v_months_in_yr := v_capped - (v_year - 1) * 12;
      END IF;
      EXIT WHEN v_months_in_yr <= 0;
      v_yearly      := ROUND(v_remaining * v_rate, 2);
      v_monthly_dep := ROUND(v_yearly / 12, 2);
      v_accum       := v_accum + ROUND(v_monthly_dep * v_months_in_yr, 2);
      IF v_year < v_current_year THEN v_remaining := v_remaining - v_yearly; END IF;
    END LOOP;
    -- 帳面價值不低於殘值
    IF p_cost - v_accum < v_salvage THEN v_accum := v_depreciable; END IF;
    v_accum := ROUND(v_accum, 2);

  ELSIF v_method = 'sum_of_years' THEN
    -- 年數合計法：第 n 年折舊 = 可折舊金額 × (剩餘年限 / 年數合計)
    v_sum_years := p_life * (p_life + 1) / 2.0;
    FOR v_year IN 1..LEAST(v_current_year, p_life) LOOP
      v_yearly      := ROUND(v_depreciable * (p_life - v_year + 1) / v_sum_years, 2);
      v_monthly_dep := ROUND(v_yearly / 12, 2);
      IF v_year < v_current_year THEN v_months_in_yr := 12;
      ELSE v_months_in_yr := v_capped - (v_year - 1) * 12;
      END IF;
      EXIT WHEN v_months_in_yr <= 0;
      v_accum := v_accum + ROUND(v_monthly_dep * v_months_in_yr, 2);
    END LOOP;
    v_accum := ROUND(v_accum, 2);

  ELSE
    RAISE EXCEPTION '不支援的折舊方法：%（支援：straight_line, declining_balance, sum_of_years）', v_method;
  END IF;

  -- 累計折舊不超過可折舊金額
  IF v_accum > v_depreciable THEN v_accum := v_depreciable; END IF;
  RETURN v_accum;
END $$;

REVOKE EXECUTE ON FUNCTION public.fa_accumulated_depreciation(NUMERIC, NUMERIC, INT, TEXT, INT) FROM anon;

-- ─── 6. RPC：secure_run_monthly_depreciation ─────────────────────────────────
-- 逐使用中資產計提 p_period（YYYY-MM）當月折舊：
--   單月金額 = A(d+1) − A(d)，d = 取得月 → 提列月的月差
--   取得當月（d=0）按日數比例（期中取得按比例）
-- 冪等：UNIQUE(organization_id, period) → 已跑過回傳既有 run（already_exists=true）
-- 傳票：一張彙總（doc_type 'depreciation_monthly'，20260705100000 種子模板：
--       借 6300 折舊費用 / 貸 1610 累計折舊，amount_expr='amount'）
-- 回傳 JSONB：{run, lines, journal_entry_id, total_amount, already_exists, skipped}

CREATE OR REPLACE FUNCTION public.secure_run_monthly_depreciation(
  p_period TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org          BIGINT;
  v_period_start DATE;
  v_period_end   DATE;
  v_days_in_mon  INT;
  v_asset        RECORD;
  v_d            INT;
  v_amount       NUMERIC;
  v_total        NUMERIC := 0;
  v_run          depreciation_runs;
  v_entry        journal_entries;
  v_executed_by  TEXT;
  v_lines        JSONB := '[]'::jsonb;
BEGIN
  v_org := current_employee_org();
  IF v_org IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_period IS NULL OR p_period !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION '期別格式錯誤，應為 YYYY-MM：%', p_period;
  END IF;

  v_period_start := (p_period || '-01')::date;
  v_period_end   := (v_period_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
  v_days_in_mon  := EXTRACT(DAY FROM v_period_end)::INT;

  -- 冪等：同組織同期已提列 → 回傳既有 run
  SELECT * INTO v_run FROM depreciation_runs
   WHERE organization_id = v_org AND period = p_period;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'run', to_jsonb(v_run),
      'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM depreciation_run_lines l WHERE l.run_id = v_run.id), '[]'::jsonb),
      'journal_entry_id', v_run.journal_entry_id,
      'total_amount', v_run.total_amount,
      'already_exists', true,
      'skipped', false
    );
  END IF;

  SELECT name INTO v_executed_by FROM employees
   WHERE auth_user_id = auth.uid() LIMIT 1;
  v_executed_by := COALESCE(v_executed_by, '系統');

  -- 逐資產計提（土地不折舊；當期尚未取得者略過）
  FOR v_asset IN
    SELECT * FROM fixed_assets
     WHERE organization_id = v_org
       AND status = '使用中'
       AND category <> '土地'
       AND acquired_date <= v_period_end
     ORDER BY id
     FOR UPDATE
  LOOP
    CONTINUE WHEN COALESCE(v_asset.cost, 0) <= 0 OR COALESCE(v_asset.useful_life, 0) <= 0;

    v_d := (EXTRACT(YEAR FROM v_period_start)::INT - EXTRACT(YEAR FROM v_asset.acquired_date)::INT) * 12
         + (EXTRACT(MONTH FROM v_period_start)::INT - EXTRACT(MONTH FROM v_asset.acquired_date)::INT);
    CONTINUE WHEN v_d < 0;

    -- 單月金額 = A(d+1) − A(d)（自動含耐用年限封頂 → 超限期為 0）
    v_amount := fa_accumulated_depreciation(v_asset.cost, v_asset.salvage_value, v_asset.useful_life, v_asset.method, v_d + 1)
              - fa_accumulated_depreciation(v_asset.cost, v_asset.salvage_value, v_asset.useful_life, v_asset.method, v_d);

    -- 取得當月：按剩餘日數比例（期中取得按比例提列）
    IF v_d = 0 THEN
      v_amount := ROUND(v_amount * (v_days_in_mon - EXTRACT(DAY FROM v_asset.acquired_date)::INT + 1)::numeric / v_days_in_mon, 2);
    END IF;

    CONTINUE WHEN v_amount <= 0;

    v_total := v_total + v_amount;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'asset_id', v_asset.id, 'asset_name', v_asset.name, 'amount', v_amount
    ));
  END LOOP;

  -- 本期無可提列 → 不建 run、不拋錯（月結 DAG 對無資產組織照常通過）
  IF v_total <= 0 THEN
    RETURN jsonb_build_object(
      'run', NULL, 'lines', '[]'::jsonb, 'journal_entry_id', NULL,
      'total_amount', 0, 'already_exists', false, 'skipped', true
    );
  END IF;

  BEGIN
    INSERT INTO depreciation_runs (organization_id, period, status, total_amount, executed_by)
    VALUES (v_org, p_period, 'draft', v_total, v_executed_by)
    RETURNING * INTO v_run;
  EXCEPTION WHEN unique_violation THEN
    -- 併發下第二筆撞 UNIQUE(org, period) → 回傳先到的那筆
    SELECT * INTO v_run FROM depreciation_runs WHERE organization_id = v_org AND period = p_period;
    RETURN jsonb_build_object(
      'run', to_jsonb(v_run),
      'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM depreciation_run_lines l WHERE l.run_id = v_run.id), '[]'::jsonb),
      'journal_entry_id', v_run.journal_entry_id,
      'total_amount', v_run.total_amount,
      'already_exists', true,
      'skipped', false
    );
  END;

  -- 一張彙總傳票（借 折舊費用 / 貸 累計折舊）；source_ref = run id → 傳票層也冪等
  v_entry := secure_auto_post_voucher(
    'depreciation_monthly',
    'depreciation_run',
    v_run.id::text,
    jsonb_build_object(
      'amount', v_total,
      'entry_date', v_period_end::text,
      'description', p_period || ' 固定資產折舊提列（' || jsonb_array_length(v_lines) || ' 項資產）'
    )
  );

  INSERT INTO depreciation_run_lines (organization_id, run_id, asset_id, asset_name, amount, journal_entry_id)
  SELECT v_org, v_run.id, (elem->>'asset_id')::bigint, elem->>'asset_name', (elem->>'amount')::numeric, v_entry.id
    FROM jsonb_array_elements(v_lines) AS elem;

  -- 規則停用（v_entry NULL）→ run 停在 draft；有傳票 → posted
  UPDATE depreciation_runs
     SET status = CASE WHEN v_entry.id IS NULL THEN 'draft' ELSE 'posted' END,
         journal_entry_id = v_entry.id
   WHERE id = v_run.id
   RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'run', to_jsonb(v_run),
    'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM depreciation_run_lines l WHERE l.run_id = v_run.id), '[]'::jsonb),
    'journal_entry_id', v_entry.id,
    'total_amount', v_total,
    'already_exists', false,
    'skipped', false
  );
END $$;

GRANT EXECUTE ON FUNCTION public.secure_run_monthly_depreciation(TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_run_monthly_depreciation(TEXT) FROM anon;

-- ─── 7. RPC：secure_dispose_fixed_asset ──────────────────────────────────────
-- 出售/報廢：累計折舊提至處分月前一月底（與月提列口徑一致，處分當月不再提列），
-- 處分損益 = 價款 − 帳面價值，經 'asset_disposal' 模板拋轉，回寫資產處分欄位。
-- 回傳 JSONB：{asset, accumulated_depreciation, book_value, gain_loss, journal_entry_id}

CREATE OR REPLACE FUNCTION public.secure_dispose_fixed_asset(
  p_asset_id      BIGINT,
  p_disposal_type TEXT,
  p_proceeds      NUMERIC DEFAULT 0,
  p_disposal_date DATE    DEFAULT CURRENT_DATE
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org      BIGINT;
  v_asset    fixed_assets;
  v_d        INT;
  v_accum    NUMERIC;
  v_book     NUMERIC;
  v_gainloss NUMERIC;
  v_proceeds NUMERIC := COALESCE(p_proceeds, 0);
  v_entry    journal_entries;
BEGIN
  v_org := current_employee_org();
  IF v_org IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;

  IF p_disposal_type NOT IN ('出售', '報廢') THEN
    RAISE EXCEPTION '處分方式必須為「出售」或「報廢」：%', p_disposal_type;
  END IF;
  IF v_proceeds < 0 THEN RAISE EXCEPTION '處分價款不可為負：%', v_proceeds; END IF;
  IF p_disposal_date IS NULL THEN RAISE EXCEPTION '缺少處分日期'; END IF;

  SELECT * INTO v_asset FROM fixed_assets
   WHERE id = p_asset_id AND organization_id = v_org
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '找不到固定資產：%', p_asset_id; END IF;
  IF v_asset.status <> '使用中' THEN RAISE EXCEPTION '資產已非使用中，不可重複處分（%）', v_asset.status; END IF;
  IF p_disposal_date < v_asset.acquired_date THEN RAISE EXCEPTION '處分日期不可早於取得日期'; END IF;

  -- 累計折舊至處分月前一月底：A(d)，d = 取得月 → 處分月的月差（土地不折舊）
  IF v_asset.category = '土地' THEN
    v_accum := 0;
  ELSE
    v_d := (EXTRACT(YEAR FROM p_disposal_date)::INT - EXTRACT(YEAR FROM v_asset.acquired_date)::INT) * 12
         + (EXTRACT(MONTH FROM p_disposal_date)::INT - EXTRACT(MONTH FROM v_asset.acquired_date)::INT);
    v_accum := fa_accumulated_depreciation(v_asset.cost, v_asset.salvage_value, v_asset.useful_life, v_asset.method, v_d);
  END IF;

  v_book     := ROUND(v_asset.cost - v_accum, 2);
  v_gainloss := ROUND(v_proceeds - v_book, 2);

  -- 借 現金(價款) + 累計折舊 (+ 處分損失) / 貸 固定資產成本 (+ 處分利益)
  v_entry := secure_auto_post_voucher(
    'asset_disposal',
    'fixed_asset_disposal',
    v_asset.id::text,
    jsonb_build_object(
      'proceeds', v_proceeds,
      'accum',    v_accum,
      'cost',     v_asset.cost,
      'gain',     GREATEST(v_gainloss, 0),
      'loss',     GREATEST(-v_gainloss, 0),
      'cost_center', v_asset.department,
      'entry_date', p_disposal_date::text,
      'description', '固定資產' || p_disposal_type || ' - ' || v_asset.name || '（' || COALESCE(v_asset.asset_code, v_asset.id::text) || '）'
    )
  );

  UPDATE fixed_assets SET
    status                    = CASE WHEN p_disposal_type = '出售' THEN '已處分' ELSE '已報廢' END,
    disposed_date             = p_disposal_date,
    disposal_type             = p_disposal_type,
    disposal_proceeds         = v_proceeds,
    disposal_gain_loss        = v_gainloss,
    disposal_journal_entry_id = v_entry.id
  WHERE id = v_asset.id
  RETURNING * INTO v_asset;

  RETURN jsonb_build_object(
    'asset', to_jsonb(v_asset),
    'accumulated_depreciation', v_accum,
    'book_value', v_book,
    'gain_loss', v_gainloss,
    'journal_entry_id', v_entry.id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.secure_dispose_fixed_asset(BIGINT, TEXT, NUMERIC, DATE) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.secure_dispose_fixed_asset(BIGINT, TEXT, NUMERIC, DATE) FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
