-- Auto-suspend pos_products when SKU stock hits zero
-- Triggered AFTER UPDATE of stock_qty on skus
-- Re-enable must be manual — staff decides when product is ready again

CREATE OR REPLACE FUNCTION trg_fn_pos_product_availability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only run when stock_qty actually changed
  IF NEW.stock_qty IS NOT DISTINCT FROM OLD.stock_qty THEN
    RETURN NEW;
  END IF;

  IF NEW.stock_qty <= 0 THEN
    -- Auto-suspend: stock depleted
    UPDATE pos_products
    SET is_available = false
    WHERE sku_id = NEW.id
      AND is_available = true;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pos_product_availability
  AFTER UPDATE OF stock_qty ON skus
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_pos_product_availability();
