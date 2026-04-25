-- ============================================================
-- apply_inventory_adjustment_atomic：庫存調整原子操作
--
-- 之前 Inventory.jsx 的 handleAdjust 只 INSERT inventory_adjustments（audit log），
-- 從不更新 stock_levels.quantity → 庫存帳跟實際永遠對不上。
--
-- 這支 RPC 一次完成：
--   1. SELECT FOR UPDATE 鎖 stock_levels 列（沒有就建一筆）
--   2. UPDATE quantity += qty_delta
--   3. INSERT inventory_adjustments audit
--
-- qty_delta 正數 = 增加庫存（盤盈/收貨）；負數 = 減少（盤虧/領用）
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_inventory_adjustment_atomic(
  p_sku_code      TEXT,
  p_warehouse     TEXT,
  p_qty_delta     NUMERIC,
  p_reason        TEXT DEFAULT NULL,
  p_operator      TEXT DEFAULT NULL,
  p_bin_code      TEXT DEFAULT NULL,
  p_organization_id INT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stock     stock_levels;
  v_sku_name  TEXT;
  v_org       INT;
  v_new_qty   NUMERIC;
BEGIN
  IF p_qty_delta = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'QTY_DELTA_ZERO');
  END IF;
  IF p_warehouse IS NULL OR p_warehouse = '' THEN
    RETURN json_build_object('ok', false, 'error', 'WAREHOUSE_REQUIRED');
  END IF;

  v_org := COALESCE(p_organization_id, current_employee_org());

  -- Lock or insert stock_levels
  SELECT * INTO v_stock FROM stock_levels
    WHERE sku_code = p_sku_code AND warehouse = p_warehouse FOR UPDATE;

  IF FOUND THEN
    v_new_qty := v_stock.quantity + p_qty_delta;
    -- 防呆：減量不可使庫存為負（盤盈例外，因為 delta 是正）
    IF v_new_qty < 0 THEN
      RETURN json_build_object(
        'ok', false,
        'error', 'INSUFFICIENT_STOCK',
        'have', v_stock.quantity,
        'requested_decrease', ABS(p_qty_delta)
      );
    END IF;
    UPDATE stock_levels SET quantity = v_new_qty WHERE id = v_stock.id;
  ELSE
    -- 沒這筆 → 只允許正向加入（負調整在 0 庫存上不合理）
    IF p_qty_delta < 0 THEN
      RETURN json_build_object('ok', false, 'error', 'STOCK_NOT_FOUND_FOR_DECREASE');
    END IF;
    INSERT INTO stock_levels (sku_code, warehouse, quantity)
    VALUES (p_sku_code, p_warehouse, p_qty_delta);
    v_new_qty := p_qty_delta;
  END IF;

  -- 取 sku name 給 audit
  SELECT name INTO v_sku_name FROM skus WHERE code = p_sku_code LIMIT 1;

  -- Audit log
  INSERT INTO inventory_adjustments
    (sku_code, sku_name, bin_code, quantity, reason, operator, organization_id)
  VALUES
    (p_sku_code, v_sku_name, p_bin_code, p_qty_delta,
     COALESCE(p_reason, '系統調整'), p_operator, v_org);

  RETURN json_build_object(
    'ok', true,
    'sku_code', p_sku_code,
    'warehouse', p_warehouse,
    'new_quantity', v_new_qty,
    'delta', p_qty_delta
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_inventory_adjustment_atomic(TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, INT) TO authenticated;
