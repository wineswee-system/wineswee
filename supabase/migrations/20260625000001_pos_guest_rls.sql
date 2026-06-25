-- Guest QR menu: allow anon (unauthenticated guests) to read menus and validate tokens
-- All reads are scoped to stores with qr_ordering_enabled = true

-- Menu categories: anon read for QR-enabled stores
CREATE POLICY "guest_qr_read" ON pos_menu_categories
  FOR SELECT TO anon
  USING (
    store_id IN (
      SELECT store_id FROM pos_store_settings WHERE qr_ordering_enabled = true
    )
  );

-- Menu items: anon read available items in QR-enabled stores
CREATE POLICY "guest_qr_read" ON pos_menu_items
  FOR SELECT TO anon
  USING (
    is_available = true
    AND store_id IN (
      SELECT store_id FROM pos_store_settings WHERE qr_ordering_enabled = true
    )
  );

-- QR sessions: anon read for token validation (guests need order_id from their session)
-- Only exposes non-revoked, non-expired sessions
CREATE POLICY "guest_qr_validate" ON qr_order_sessions
  FOR SELECT TO anon
  USING (
    revoked_at IS NULL
    AND expires_at > now()
  );
