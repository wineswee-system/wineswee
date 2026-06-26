-- POS: 作廢品項 / 整單作廢 / 折扣 / 退款
-- ─────────────────────────────────────────

-- 1. pos_orders: 外帶 + 折扣欄位
ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS order_type     TEXT DEFAULT 'dine_in' CHECK (order_type IN ('dine_in','takeout')),
  ADD COLUMN IF NOT EXISTS discount_type  TEXT CHECK (discount_type IN ('percent','fixed')),
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0;

-- 2. pos_order_items: 作廢支援
ALTER TABLE pos_order_items
  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- 3. 退款記錄表
CREATE TABLE IF NOT EXISTS pos_refunds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id INT  NOT NULL REFERENCES organizations(id),
  store_id        INT  NOT NULL REFERENCES stores(id),
  order_id        UUID NOT NULL REFERENCES pos_orders(id),
  amount          NUMERIC(10,2) NOT NULL,
  reason          TEXT,
  item_ids        UUID[],
  refunded_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pos_refunds ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pos_refunds' AND policyname='staff') THEN
    CREATE POLICY "staff" ON pos_refunds FOR ALL TO authenticated USING (organization_id = auth_org_id());
  END IF;
END $$;

-- 4. RPC: 作廢單一品項（訂單必須是 open/submitted 狀態）
CREATE OR REPLACE FUNCTION public.pos_void_item(
  p_item_id UUID,
  p_reason  TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE pos_order_items
     SET voided_at   = now(),
         void_reason = p_reason
   WHERE id = p_item_id
     AND voided_at IS NULL
     AND order_id IN (
           SELECT id FROM pos_orders WHERE status IN ('open','submitted')
         );
  IF NOT FOUND THEN
    RAISE EXCEPTION '品項不存在或訂單已結帳/作廢';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.pos_void_item(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.pos_void_item(UUID, TEXT) TO authenticated;

-- 5. RPC: 作廢整張訂單（只能作廢未結帳的單）
CREATE OR REPLACE FUNCTION public.pos_void_order(
  p_order_id UUID,
  p_reason   TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE pos_orders
     SET status = 'voided',
         note   = COALESCE(p_reason || ' | ' || COALESCE(note,''), note)
   WHERE id = p_order_id
     AND status IN ('open','submitted');
  IF NOT FOUND THEN
    RAISE EXCEPTION '訂單不存在或已結帳/作廢';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.pos_void_order(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.pos_void_order(UUID, TEXT) TO authenticated;

-- 6. RPC: 對已結帳訂單的指定品項退款
CREATE OR REPLACE FUNCTION public.pos_refund_order(
  p_order_id UUID,
  p_item_ids UUID[],
  p_reason   TEXT DEFAULT '客戶退款'
) RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id   INT;
  v_store_id INT;
  v_amount   NUMERIC;
BEGIN
  SELECT organization_id, store_id INTO v_org_id, v_store_id
    FROM pos_orders
   WHERE id = p_order_id AND status = 'paid';
  IF NOT FOUND THEN
    RAISE EXCEPTION '訂單不存在或尚未結帳';
  END IF;

  SELECT COALESCE(SUM(unit_price * quantity), 0)
    INTO v_amount
    FROM pos_order_items
   WHERE order_id = p_order_id
     AND id = ANY(p_item_ids)
     AND voided_at IS NULL;

  IF v_amount = 0 THEN
    RAISE EXCEPTION '未選擇有效品項（或品項已退款）';
  END IF;

  -- 標記品項為退款作廢
  UPDATE pos_order_items
     SET voided_at = now(), void_reason = p_reason
   WHERE order_id = p_order_id
     AND id = ANY(p_item_ids)
     AND voided_at IS NULL;

  -- 寫退款記錄
  INSERT INTO pos_refunds (organization_id, store_id, order_id, amount, reason, item_ids)
  VALUES (v_org_id, v_store_id, p_order_id, v_amount, p_reason, p_item_ids);

  RETURN v_amount;
END $$;

REVOKE ALL ON FUNCTION public.pos_refund_order(UUID, UUID[], TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.pos_refund_order(UUID, UUID[], TEXT) TO authenticated;
