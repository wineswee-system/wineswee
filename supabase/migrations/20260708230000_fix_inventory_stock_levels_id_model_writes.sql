-- Tier3 庫存(A):寫入類函式對齊 stock_levels 新 id 制 — 2026-07-08
-- 背景:stock_levels 已遷成 (sku_id, warehouse_id)(75 筆真資料),但函式還用舊 sku_code/warehouse。
--   其他表維持原制:inventory_transactions(sku/warehouse 文字)、inventory_adjustments(sku_code 文字+
--   warehouse_id、無 unit_cost)、outbound_items(sku_code、quantity、outbound_order_id)、stock_counts(warehouse 文字)。
-- 修法:碰 stock_levels 就把 sku_code→skus.id、倉庫名→warehouses.id;前端合約(傳文字)不變。
-- 決定:min_qty 不進 stock_levels(改由 skus.safety_stock);stock_levels 加 UNIQUE(sku_id,warehouse_id)。
-- 已驗:skus.code/ warehouses.name 對照、(sku_id,warehouse_id) 0 重複、outbound_items 真欄名。idempotent。

-- 0) stock_levels 唯一鍵(upsert 需要;0 重複、bin_id 全 null)
CREATE UNIQUE INDEX IF NOT EXISTS stock_levels_sku_wh_uniq
  ON public.stock_levels (sku_id, warehouse_id);

-- 1) secure_create_inventory_adjustment:inventory_adjustments 無 unit_cost 欄;stock_levels 改 id
CREATE OR REPLACE FUNCTION public.secure_create_inventory_adjustment(p_sku_code text, p_sku_name text, p_bin_code text, p_quantity numeric, p_reason text, p_operator text, p_unit_cost numeric DEFAULT 0)
 RETURNS inventory_adjustments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result inventory_adjustments;
  v_valid_reasons TEXT[] := ARRAY[
    'cycle_count', 'damage', 'return', 'correction',
    'write_off', 'found', 'production', 'sample'
  ];
BEGIN
  IF p_sku_code IS NULL OR p_sku_code = '' THEN
    RAISE EXCEPTION 'SKU 代碼不可為空';
  END IF;
  IF p_operator IS NULL OR p_operator = '' THEN
    RAISE EXCEPTION '操作人員不可為空';
  END IF;
  IF p_reason IS NULL OR NOT (p_reason = ANY(v_valid_reasons)) THEN
    RAISE EXCEPTION '無效的調整原因：%。有效值：%', p_reason, array_to_string(v_valid_reasons, ', ');
  END IF;

  -- inventory_adjustments 無 unit_cost 欄(p_unit_cost 保留簽章相容但不入帳)
  INSERT INTO inventory_adjustments (sku_code, sku_name, bin_code, quantity, reason, operator)
  VALUES (p_sku_code, p_sku_name, p_bin_code, ROUND(p_quantity::NUMERIC, 2), p_reason, p_operator)
  RETURNING * INTO v_result;

  -- 同步 stock_levels(若存在):sku_code→skus.id、bin_code 當倉庫名解 warehouses.id(沿用原行為)
  UPDATE stock_levels
  SET quantity = quantity + ROUND(p_quantity::NUMERIC, 2),
      updated_at = now()
  WHERE sku_id = (SELECT id FROM skus WHERE code = p_sku_code LIMIT 1)
    AND warehouse_id = (SELECT id FROM warehouses WHERE name = COALESCE(p_bin_code, 'default') LIMIT 1);

  RETURN v_result;
END;
$function$;

-- 2) apply_inventory_adjustment_atomic(前端 Inventory.jsx 調整用):stock_levels 改 id
CREATE OR REPLACE FUNCTION public.apply_inventory_adjustment_atomic(p_sku_code text, p_warehouse text, p_qty_delta numeric, p_reason text DEFAULT NULL::text, p_operator text DEFAULT NULL::text, p_bin_code text DEFAULT NULL::text, p_organization_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stock     stock_levels;
  v_sku_name  TEXT;
  v_org       INT;
  v_new_qty   NUMERIC;
  v_sku_id    INT;
  v_wh_id     INT;
BEGIN
  IF p_qty_delta = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'QTY_DELTA_ZERO');
  END IF;
  IF p_warehouse IS NULL OR p_warehouse = '' THEN
    RETURN json_build_object('ok', false, 'error', 'WAREHOUSE_REQUIRED');
  END IF;

  v_org := COALESCE(p_organization_id, current_employee_org());

  v_sku_id := (SELECT id FROM skus WHERE code = p_sku_code
                AND (organization_id = v_org OR organization_id IS NULL)
                ORDER BY (organization_id = v_org) DESC NULLS LAST LIMIT 1);
  v_wh_id  := (SELECT id FROM warehouses WHERE name = p_warehouse
                AND (organization_id = v_org OR organization_id IS NULL)
                ORDER BY (organization_id = v_org) DESC NULLS LAST LIMIT 1);
  IF v_sku_id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'SKU_NOT_FOUND'); END IF;
  IF v_wh_id  IS NULL THEN RETURN json_build_object('ok', false, 'error', 'WAREHOUSE_NOT_FOUND'); END IF;

  SELECT * INTO v_stock FROM stock_levels
    WHERE sku_id = v_sku_id AND warehouse_id = v_wh_id FOR UPDATE;

  IF FOUND THEN
    v_new_qty := v_stock.quantity + p_qty_delta;
    IF v_new_qty < 0 THEN
      RETURN json_build_object(
        'ok', false, 'error', 'INSUFFICIENT_STOCK',
        'have', v_stock.quantity, 'requested_decrease', ABS(p_qty_delta));
    END IF;
    UPDATE stock_levels SET quantity = v_new_qty, updated_at = now() WHERE id = v_stock.id;
  ELSE
    IF p_qty_delta < 0 THEN
      RETURN json_build_object('ok', false, 'error', 'STOCK_NOT_FOUND_FOR_DECREASE');
    END IF;
    INSERT INTO stock_levels (sku_id, warehouse_id, quantity, organization_id)
    VALUES (v_sku_id, v_wh_id, p_qty_delta, v_org);
    v_new_qty := p_qty_delta;
  END IF;

  SELECT name INTO v_sku_name FROM skus WHERE id = v_sku_id LIMIT 1;

  INSERT INTO inventory_adjustments
    (sku_code, sku_name, bin_code, quantity, reason, operator, organization_id)
  VALUES
    (p_sku_code, v_sku_name, p_bin_code, p_qty_delta,
     COALESCE(p_reason, '系統調整'), p_operator, v_org);

  RETURN json_build_object(
    'ok', true, 'sku_code', p_sku_code, 'warehouse', p_warehouse,
    'new_quantity', v_new_qty, 'delta', p_qty_delta);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

-- 3) transfer_inventory_atomic:兩倉 stock_levels 改 id
CREATE OR REPLACE FUNCTION public.transfer_inventory_atomic(p_sku_code text, p_from_warehouse text, p_to_warehouse text, p_qty numeric, p_reason text DEFAULT NULL::text, p_operator text DEFAULT NULL::text, p_organization_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_from   stock_levels;
  v_to     stock_levels;
  v_sku_name TEXT;
  v_org    INT;
  v_sku_id INT;
  v_from_wh INT;
  v_to_wh  INT;
BEGIN
  IF p_qty <= 0 THEN RAISE EXCEPTION 'QTY_MUST_BE_POSITIVE'; END IF;
  IF p_from_warehouse = p_to_warehouse THEN RAISE EXCEPTION 'SAME_WAREHOUSE'; END IF;

  v_org := COALESCE(p_organization_id, current_employee_org());

  v_sku_id  := (SELECT id FROM skus WHERE code = p_sku_code
                 AND (organization_id = v_org OR organization_id IS NULL)
                 ORDER BY (organization_id = v_org) DESC NULLS LAST LIMIT 1);
  v_from_wh := (SELECT id FROM warehouses WHERE name = p_from_warehouse LIMIT 1);
  v_to_wh   := (SELECT id FROM warehouses WHERE name = p_to_warehouse LIMIT 1);
  IF v_sku_id  IS NULL THEN RAISE EXCEPTION 'SKU_NOT_FOUND: %', p_sku_code; END IF;
  IF v_from_wh IS NULL THEN RAISE EXCEPTION 'FROM_WAREHOUSE_NOT_FOUND: %', p_from_warehouse; END IF;
  IF v_to_wh   IS NULL THEN RAISE EXCEPTION 'TO_WAREHOUSE_NOT_FOUND: %', p_to_warehouse; END IF;

  SELECT * INTO v_from FROM stock_levels
    WHERE sku_id = v_sku_id AND warehouse_id = v_from_wh FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCE_NOT_FOUND'; END IF;
  IF v_from.quantity < p_qty THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: have %, need %', v_from.quantity, p_qty;
  END IF;

  SELECT name INTO v_sku_name FROM skus WHERE id = v_sku_id LIMIT 1;

  UPDATE stock_levels SET quantity = quantity - p_qty, updated_at = now() WHERE id = v_from.id;

  SELECT * INTO v_to FROM stock_levels
    WHERE sku_id = v_sku_id AND warehouse_id = v_to_wh FOR UPDATE;
  IF FOUND THEN
    UPDATE stock_levels SET quantity = quantity + p_qty, updated_at = now() WHERE id = v_to.id;
  ELSE
    INSERT INTO stock_levels (sku_id, warehouse_id, quantity, organization_id)
      VALUES (v_sku_id, v_to_wh, p_qty, v_org);
  END IF;

  INSERT INTO inventory_adjustments
    (sku_code, sku_name, quantity, reason, operator, organization_id)
  VALUES
    (p_sku_code, v_sku_name, -p_qty,
     COALESCE(p_reason, '轉倉至 ' || p_to_warehouse), p_operator, v_org),
    (p_sku_code, v_sku_name,  p_qty,
     COALESCE(p_reason, '從 '   || p_from_warehouse || ' 轉入'), p_operator, v_org);

  RETURN json_build_object(
    'ok', true, 'sku_code', p_sku_code, 'qty', p_qty,
    'from', p_from_warehouse, 'to', p_to_warehouse);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

-- 4) commit_outbound_shipment:outbound_items 真欄名(outbound_order_id/quantity);stock_levels 改 id
CREATE OR REPLACE FUNCTION public.commit_outbound_shipment(p_outbound_id integer, p_warehouse text DEFAULT NULL::text, p_actor text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order      outbound_orders;
  v_warehouse  TEXT;
  v_wh_id      INT;
  rec          RECORD;
  v_stock      stock_levels;
  v_org        INT;
  v_decremented int := 0;
BEGIN
  SELECT * INTO v_order FROM outbound_orders WHERE id = p_outbound_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTBOUND_NOT_FOUND'; END IF;
  IF v_order.status = '已出貨' THEN RAISE EXCEPTION 'ALREADY_SHIPPED'; END IF;

  v_warehouse := COALESCE(p_warehouse, v_order.warehouse);
  IF v_warehouse IS NULL OR v_warehouse = '' THEN RAISE EXCEPTION 'WAREHOUSE_REQUIRED'; END IF;

  v_org := v_order.organization_id;
  v_wh_id := (SELECT id FROM warehouses WHERE name = v_warehouse LIMIT 1);
  IF v_wh_id IS NULL THEN RAISE EXCEPTION 'WAREHOUSE_NOT_FOUND: %', v_warehouse; END IF;

  FOR rec IN
    SELECT id, sku_code, sku_name, COALESCE(picked_qty, quantity, 0) AS use_qty
    FROM outbound_items
    WHERE outbound_order_id = p_outbound_id
    ORDER BY id
    FOR UPDATE
  LOOP
    IF rec.use_qty > 0 THEN
      SELECT * INTO v_stock FROM stock_levels
        WHERE sku_id = (SELECT id FROM skus WHERE code = rec.sku_code LIMIT 1)
          AND warehouse_id = v_wh_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'STOCK_NOT_FOUND: % @ %', rec.sku_code, v_warehouse;
      END IF;
      IF v_stock.quantity < rec.use_qty THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: % @ % (need %, have %)',
          rec.sku_code, v_warehouse, rec.use_qty, v_stock.quantity;
      END IF;

      UPDATE stock_levels SET quantity = quantity - rec.use_qty, updated_at = now()
        WHERE id = v_stock.id;

      INSERT INTO inventory_adjustments
        (sku_code, sku_name, quantity, reason, operator, organization_id)
      VALUES
        (rec.sku_code, rec.sku_name, -rec.use_qty, '出貨#' || p_outbound_id, p_actor, v_org);

      v_decremented := v_decremented + 1;
    END IF;
  END LOOP;

  UPDATE outbound_orders SET status = '已出貨', shipped_date = CURRENT_DATE WHERE id = p_outbound_id;

  RETURN json_build_object(
    'ok', true, 'outbound_id', p_outbound_id,
    'items_decremented', v_decremented, 'warehouse', v_warehouse);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

-- 5) pos__adjust_stock(POS 扣帳):stock_levels 改 sku_id 查;IT 寫入需倉庫名(從 warehouse_id 解)
CREATE OR REPLACE FUNCTION public.pos__adjust_stock(p_org integer, p_items jsonb, p_direction integer, p_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item      JSONB;
  v_name      TEXT;
  v_qty       NUMERIC;
  v_sku_id    INT;
  v_sku_code  TEXT;
  v_stock     RECORD;
  v_new_qty   NUMERIC;
  v_wh_name   TEXT;
  v_has_it    BOOLEAN := to_regclass('public.inventory_transactions') IS NOT NULL;
BEGIN
  IF p_items IS NULL THEN RETURN; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_name := v_item->>'name';
    v_qty  := COALESCE((v_item->>'qty')::NUMERIC, 0);
    IF v_name IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    -- 品名 → SKU（優先本租戶）
    SELECT s.id, s.code INTO v_sku_id, v_sku_code FROM skus s
     WHERE s.name = v_name AND (s.organization_id = p_org OR s.organization_id IS NULL)
     ORDER BY (s.organization_id = p_org) DESC NULLS LAST
     LIMIT 1;
    IF v_sku_id IS NULL THEN CONTINUE; END IF;  -- 非庫存品(現做餐飲)→ 略過

    SELECT * INTO v_stock FROM stock_levels
     WHERE sku_id = v_sku_id
       AND (organization_id = p_org OR organization_id IS NULL)
     ORDER BY (organization_id = p_org) DESC NULLS LAST, quantity DESC
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_new_qty := GREATEST(0, COALESCE(v_stock.quantity, 0) + (p_direction * v_qty));
    UPDATE stock_levels SET quantity = v_new_qty, updated_at = now() WHERE id = v_stock.id;

    IF v_has_it THEN
      v_wh_name := (SELECT name FROM warehouses WHERE id = v_stock.warehouse_id);
      INSERT INTO inventory_transactions (sku, date, type, qty, warehouse, reference, organization_id)
      VALUES (
        v_sku_code, CURRENT_DATE,
        CASE WHEN p_direction < 0 THEN 'OUT' ELSE 'IN' END,
        v_qty, v_wh_name, p_reference, p_org
      );
    END IF;
  END LOOP;
END;
$function$;

-- 6) secure_bulk_upsert_stock_levels(匯入):sku_code→id、倉名→id、去 min_qty、ON CONFLICT(sku_id,warehouse_id)
CREATE OR REPLACE FUNCTION public.secure_bulk_upsert_stock_levels(p_rows jsonb)
 RETURNS SETOF stock_levels
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row JSONB;
  v_idx INT := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION '庫存資料不可為空';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_idx := v_idx + 1;
    IF v_row->>'sku_code' IS NULL OR v_row->>'sku_code' = '' THEN
      RAISE EXCEPTION '第 % 筆缺少 sku_code', v_idx;
    END IF;
    IF v_row->>'warehouse' IS NULL OR v_row->>'warehouse' = '' THEN
      RAISE EXCEPTION '第 % 筆缺少 warehouse', v_idx;
    END IF;
    IF COALESCE((v_row->>'quantity')::NUMERIC, 0) < 0 THEN
      RAISE EXCEPTION '第 % 筆庫存數量不可為負', v_idx;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM skus WHERE code = v_row->>'sku_code') THEN
      RAISE EXCEPTION '第 % 筆 SKU 代碼不存在：%', v_idx, v_row->>'sku_code';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM warehouses WHERE name = v_row->>'warehouse') THEN
      RAISE EXCEPTION '第 % 筆倉庫不存在：%', v_idx, v_row->>'warehouse';
    END IF;
  END LOOP;

  RETURN QUERY
  INSERT INTO stock_levels (sku_id, warehouse_id, quantity)
  SELECT
    (SELECT id FROM skus WHERE code = elem->>'sku_code' LIMIT 1),
    (SELECT id FROM warehouses WHERE name = elem->>'warehouse' LIMIT 1),
    COALESCE((elem->>'quantity')::NUMERIC, 0)
  FROM jsonb_array_elements(p_rows) AS elem
  ON CONFLICT (sku_id, warehouse_id)
  DO UPDATE SET
    quantity   = EXCLUDED.quantity,
    updated_at = now()
  RETURNING *;
END;
$function$;

NOTIFY pgrst, 'reload schema';
