-- Guest QR menu: allow anon (unauthenticated guests) to read menus and validate tokens
-- All reads are scoped to stores with qr_ordering_enabled = true

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pos_menu_categories' AND policyname = 'guest_qr_read') THEN
    CREATE POLICY "guest_qr_read" ON pos_menu_categories
      FOR SELECT TO anon
      USING (store_id IN (SELECT store_id FROM pos_store_settings WHERE qr_ordering_enabled = true));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pos_menu_items' AND policyname = 'guest_qr_read') THEN
    CREATE POLICY "guest_qr_read" ON pos_menu_items
      FOR SELECT TO anon
      USING (
        is_available = true
        AND store_id IN (SELECT store_id FROM pos_store_settings WHERE qr_ordering_enabled = true)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qr_order_sessions' AND policyname = 'guest_qr_validate') THEN
    CREATE POLICY "guest_qr_validate" ON qr_order_sessions
      FOR SELECT TO anon
      USING (revoked_at IS NULL AND expires_at > now());
  END IF;
END $$;
