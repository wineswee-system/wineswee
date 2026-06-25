-- Atomic order-number generator for POS shifts.
-- Called by posDb.getOrCreateOrder via supabase.rpc('next_order_number', { p_shift_id }).
-- Uses UPDATE...RETURNING so the increment is a single atomic statement — no race condition
-- even if two staff open orders in the same millisecond.

CREATE OR REPLACE FUNCTION next_order_number(p_shift_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_counter INT;
BEGIN
  UPDATE pos_shifts
     SET order_counter = order_counter + 1
   WHERE id = p_shift_id
  RETURNING order_counter INTO v_counter;

  RETURN LPAD(v_counter::TEXT, 3, '0');
END;
$$;
