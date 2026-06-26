-- Allow unauthenticated guests to read the store name and table number
-- needed by GuestMenu.jsx to display the header (storeName, tableNo).
-- Scoped to stores where qr_ordering_enabled = true so non-QR stores stay private.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stores' AND policyname = 'guest_qr_read') THEN
    CREATE POLICY "guest_qr_read" ON stores
      FOR SELECT TO anon
      USING (id IN (SELECT store_id FROM pos_store_settings WHERE qr_ordering_enabled = true));
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'res_tables')
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'res_tables' AND policyname = 'guest_qr_read') THEN
    CREATE POLICY "guest_qr_read" ON res_tables
      FOR SELECT TO anon
      USING (store_id IN (SELECT store_id FROM pos_store_settings WHERE qr_ordering_enabled = true));
  END IF;
END $$;
