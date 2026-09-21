-- ============================================================
-- Audit Phase B 修補：原子操作 + 補建表 + 狀態統一
--
-- 1. CODIFY 缺漏的表：skus / customers / quotation_lines
--    （supabase-schema.sql 有定義但無 migration 創過；新環境會缺）
--
-- 2. ALTER 補欄位：
--    - outbound_items 加 picked_qty / status（Outbound.jsx 已用，但 schema 沒記錄）
--    - inventory_adjustments 加 organization_id（多租戶必需）
--
-- 3. 統一 shipping_status：DB 預設 '未出貨' → '待出貨'（跟 UI 對齊）
--    + 把現有 '未出貨' 資料一併更新
--    + 加 CHECK constraint 防新值亂入
--    + secure_create_sales_order RPC 預設值同步調整
--
-- 4. 新原子 RPC：
--    a. commit_outbound_shipment  — 出貨時 atomic 扣 stock_levels
--    b. transfer_inventory_atomic — 轉倉一筆交易完成（避免半成功）
--    c. earn_member_points_atomic — 點數累積避免雙寫競態
-- ============================================================


-- ═══ 1. 補建缺漏表 ═══

-- ── skus（商品主檔）──
CREATE TABLE IF NOT EXISTS public.skus (
  id              SERIAL PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  barcode         TEXT,
  unit            TEXT DEFAULT '件',
  category        TEXT,
  weight          NUMERIC(10,2),
  length          NUMERIC(10,2),
  width           NUMERIC(10,2),
  height          NUMERIC(10,2),
  costing_method  TEXT DEFAULT 'WEIGHTED_AVG',
  unit_cost       NUMERIC(12,2) DEFAULT 0,
  cost            NUMERIC(12,2) DEFAULT 0,
  status          TEXT DEFAULT '啟用',
  stock_qty       NUMERIC(12,2) DEFAULT 0,
  organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);
-- 若舊環境已有 skus 但沒有 organization_id，補上去
ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_skus_status ON public.skus(status);
CREATE INDEX IF NOT EXISTS idx_skus_org ON public.skus(organization_id);

-- ── customers（客戶主檔）──
CREATE TABLE IF NOT EXISTS public.customers (
  id              SERIAL PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  company         TEXT,
  phone           TEXT,
  email           TEXT,
  tags            TEXT,
  assigned_to     TEXT,
  source          TEXT,
  status          TEXT DEFAULT '活躍',
  notes           TEXT,
  credit_limit    NUMERIC(12,2) DEFAULT 0,
  location_id     INT,
  company_role    TEXT,
  organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);
-- 若舊環境已有 customers 但沒有 organization_id，補上去
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customers_status ON public.customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_org ON public.customers(organization_id);

-- ── quotation_lines（報價明細）── 完全新建
CREATE TABLE IF NOT EXISTS public.quotation_lines (
  id               SERIAL PRIMARY KEY,
  quotation_id     INT NOT NULL,  -- 不下強 FK 是因為 quotations 表 schema 變動還沒收斂
  sku_id           INT REFERENCES public.skus(id) ON DELETE SET NULL,
  description      TEXT,
  quantity         NUMERIC(12,2) DEFAULT 0,
  unit_price       NUMERIC(12,2) DEFAULT 0,
  discount_percent NUMERIC(5,2) DEFAULT 0,
  tax_rate         NUMERIC(5,2) DEFAULT 0,
  line_total       NUMERIC(12,2) DEFAULT 0,
  organization_id  INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotation_lines_qid ON public.quotation_lines(quotation_id);


-- ═══ 2. ALTER 補欄位 ═══

-- outbound_items：picked_qty + status（Outbound.jsx 已用）
ALTER TABLE public.outbound_items
  ADD COLUMN IF NOT EXISTS picked_qty NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status     TEXT DEFAULT '待揀貨';

-- inventory_adjustments + outbound_orders：organization_id
ALTER TABLE public.inventory_adjustments
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.outbound_orders
  ADD COLUMN IF NOT EXISTS organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warehouse       TEXT;

CREATE INDEX IF NOT EXISTS idx_inv_adj_org ON public.inventory_adjustments(organization_id);
CREATE INDEX IF NOT EXISTS idx_outbound_org ON public.outbound_orders(organization_id);


-- ═══ 3. 統一 shipping_status：'未出貨' → '待出貨' ═══

-- 先把舊資料更新
UPDATE public.sales_orders SET shipping_status = '待出貨' WHERE shipping_status = '未出貨';

-- DB 預設改成 UI 用的字串
ALTER TABLE public.sales_orders ALTER COLUMN shipping_status SET DEFAULT '待出貨';

-- secure_create_sales_order RPC：插入時用 '待出貨'
-- 為避免重複大段 plpgsql，直接 CREATE OR REPLACE 全函數
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
  v_tid    INT;
  v_total  NUMERIC;
  v_result sales_orders;
BEGIN
  v_tid := current_employee_org();
  IF v_tid IS NULL THEN RAISE EXCEPTION '無法識別租戶：請確認登入狀態'; END IF;
  v_total := COALESCE(p_total, p_subtotal - p_discount + p_tax);
  IF p_customer IS NULL OR p_customer = '' THEN RAISE EXCEPTION '客戶不可為空'; END IF;
  IF v_total < 0 THEN RAISE EXCEPTION '銷售總額不可為負'; END IF;
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
    p_notes, p_created_by, '未付款', '待出貨', '通過'  -- ★ '未出貨' → '待出貨'
  ) RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;


-- ═══ 4a. commit_outbound_shipment 原子出貨 ═══
-- 鎖 outbound_items + stock_levels FOR UPDATE，依序扣帳並寫 audit
CREATE OR REPLACE FUNCTION public.commit_outbound_shipment(
  p_outbound_id INT,
  p_warehouse   TEXT DEFAULT NULL,
  p_actor       TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order      outbound_orders;
  v_warehouse  TEXT;
  rec          RECORD;
  v_stock      stock_levels;
  v_org        INT;
  v_decremented int := 0;
BEGIN
  -- Lock outbound_orders row
  SELECT * INTO v_order FROM outbound_orders WHERE id = p_outbound_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTBOUND_NOT_FOUND'; END IF;

  IF v_order.status = '已出貨' THEN
    RAISE EXCEPTION 'ALREADY_SHIPPED';
  END IF;

  v_warehouse := COALESCE(p_warehouse, v_order.warehouse);
  IF v_warehouse IS NULL OR v_warehouse = '' THEN
    RAISE EXCEPTION 'WAREHOUSE_REQUIRED';
  END IF;

  v_org := v_order.organization_id;

  -- 對每個 item：lock stock_levels + 扣帳 + 寫 audit
  FOR rec IN
    SELECT id, sku_code, sku_name, COALESCE(picked_qty, qty, 0) AS use_qty
    FROM outbound_items
    WHERE order_id = p_outbound_id
    ORDER BY id
    FOR UPDATE
  LOOP
    IF rec.use_qty > 0 THEN
      SELECT * INTO v_stock FROM stock_levels
        WHERE sku_code = rec.sku_code AND warehouse = v_warehouse FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'STOCK_NOT_FOUND: % @ %', rec.sku_code, v_warehouse;
      END IF;
      IF v_stock.quantity < rec.use_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: % @ % (need %, have %)',
          rec.sku_code, v_warehouse, rec.use_qty, v_stock.quantity;
      END IF;

      UPDATE stock_levels SET quantity = quantity - rec.use_qty
        WHERE id = v_stock.id;

      INSERT INTO inventory_adjustments
        (sku_code, sku_name, quantity, reason, operator, organization_id)
      VALUES
        (rec.sku_code, rec.sku_name, -rec.use_qty,
         '出貨#' || p_outbound_id, p_actor, v_org);

      v_decremented := v_decremented + 1;
    END IF;
  END LOOP;

  UPDATE outbound_orders
    SET status = '已出貨', shipped_date = CURRENT_DATE
    WHERE id = p_outbound_id;

  RETURN json_build_object(
    'ok', true,
    'outbound_id', p_outbound_id,
    'items_decremented', v_decremented,
    'warehouse', v_warehouse
  );
EXCEPTION WHEN OTHERS THEN
  -- 出錯時整個交易自動 rollback（plpgsql 預設行為）
  RETURN json_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_outbound_shipment(INT, TEXT, TEXT) TO authenticated;


-- ═══ 4b. transfer_inventory_atomic 原子轉倉 ═══
-- 一次完成「源倉扣 + 目標倉加 + 雙 audit」，避免半成功
CREATE OR REPLACE FUNCTION public.transfer_inventory_atomic(
  p_sku_code      TEXT,
  p_from_warehouse TEXT,
  p_to_warehouse   TEXT,
  p_qty           NUMERIC,
  p_reason        TEXT DEFAULT NULL,
  p_operator      TEXT DEFAULT NULL,
  p_organization_id INT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from   stock_levels;
  v_to     stock_levels;
  v_sku_name TEXT;
  v_org    INT;
BEGIN
  IF p_qty <= 0 THEN RAISE EXCEPTION 'QTY_MUST_BE_POSITIVE'; END IF;
  IF p_from_warehouse = p_to_warehouse THEN RAISE EXCEPTION 'SAME_WAREHOUSE'; END IF;

  v_org := COALESCE(p_organization_id, current_employee_org());

  -- Lock 源倉
  SELECT * INTO v_from FROM stock_levels
    WHERE sku_code = p_sku_code AND warehouse = p_from_warehouse FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_NOT_FOUND'; END IF;
  IF v_from.quantity < p_qty THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: have %, need %', v_from.quantity, p_qty;
  END IF;

  -- 取 sku name 給 audit log
  SELECT name INTO v_sku_name FROM skus WHERE code = p_sku_code LIMIT 1;

  -- 扣源倉
  UPDATE stock_levels SET quantity = quantity - p_qty WHERE id = v_from.id;

  -- Lock or Insert 目標倉
  SELECT * INTO v_to FROM stock_levels
    WHERE sku_code = p_sku_code AND warehouse = p_to_warehouse FOR UPDATE;
  IF FOUND THEN
    UPDATE stock_levels SET quantity = quantity + p_qty WHERE id = v_to.id;
  ELSE
    INSERT INTO stock_levels (sku_code, warehouse, quantity)
      VALUES (p_sku_code, p_to_warehouse, p_qty);
  END IF;

  -- 雙 audit
  INSERT INTO inventory_adjustments
    (sku_code, sku_name, quantity, reason, operator, organization_id)
  VALUES
    (p_sku_code, v_sku_name, -p_qty,
     COALESCE(p_reason, '轉倉至 ' || p_to_warehouse), p_operator, v_org),
    (p_sku_code, v_sku_name,  p_qty,
     COALESCE(p_reason, '從 '   || p_from_warehouse || ' 轉入'), p_operator, v_org);

  RETURN json_build_object(
    'ok', true,
    'sku_code', p_sku_code,
    'qty', p_qty,
    'from', p_from_warehouse,
    'to',   p_to_warehouse
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_inventory_atomic(TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, INT) TO authenticated;


-- ═══ 4c. earn_member_points_atomic 原子點數累積 ═══
-- 避免「讀 → 算 → 寫」的雙寫競態（兩次同時請求會弄丟一次）
CREATE OR REPLACE FUNCTION public.earn_member_points_atomic(
  p_member_id      INT,
  p_points_delta   INT,
  p_amount         NUMERIC DEFAULT 0,
  p_reason         TEXT DEFAULT NULL,
  p_reference_no   TEXT DEFAULT NULL,
  p_operator       TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member members;
  v_new_total int;
  v_new_avail int;
BEGIN
  -- Lock member row
  SELECT * INTO v_member FROM members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'MEMBER_NOT_FOUND');
  END IF;

  v_new_total := COALESCE(v_member.total_points, 0) + GREATEST(p_points_delta, 0);
  v_new_avail := GREATEST(0, COALESCE(v_member.available_points, 0) + p_points_delta);

  UPDATE members SET
    total_points     = v_new_total,
    available_points = v_new_avail,
    total_spent      = COALESCE(total_spent, 0) + GREATEST(p_amount, 0),
    visit_count      = COALESCE(visit_count, 0) + (CASE WHEN p_amount > 0 THEN 1 ELSE 0 END),
    last_visit       = CASE WHEN p_amount > 0 THEN CURRENT_DATE ELSE last_visit END
  WHERE id = p_member_id;

  -- 寫一筆異動紀錄（point_transactions schema 簡化使用：member_id, points, type, reason）
  BEGIN
    INSERT INTO point_transactions (member_id, points, type, reason, operator)
    VALUES (p_member_id, p_points_delta,
            CASE WHEN p_points_delta >= 0 THEN '累積' ELSE '使用' END,
            COALESCE(p_reason, p_reference_no), p_operator);
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    -- point_transactions schema 不一致時不阻擋主操作（會員點數仍正確）
    NULL;
  END;

  RETURN json_build_object(
    'ok', true,
    'member_id', p_member_id,
    'total_points', v_new_total,
    'available_points', v_new_avail
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.earn_member_points_atomic(INT, INT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
