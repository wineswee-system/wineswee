-- 刪門市時，POS 資料一起清（CASCADE）；HR/員工欄位清 NULL（SET NULL）
-- idempotent: DROP CONSTRAINT IF EXISTS + ADD

-- ── POS 資料：全 CASCADE ──────────────────────────────────────
ALTER TABLE public.pos_menu_categories
  DROP CONSTRAINT IF EXISTS pos_menu_categories_store_id_fkey,
  ADD CONSTRAINT pos_menu_categories_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE public.pos_menu_items
  DROP CONSTRAINT IF EXISTS pos_menu_items_store_id_fkey,
  ADD CONSTRAINT pos_menu_items_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE public.pos_products
  DROP CONSTRAINT IF EXISTS pos_products_store_id_fkey,
  ADD CONSTRAINT pos_products_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE public.pos_shifts
  DROP CONSTRAINT IF EXISTS pos_shifts_store_id_fkey,
  ADD CONSTRAINT pos_shifts_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE public.pos_orders
  DROP CONSTRAINT IF EXISTS pos_orders_store_id_fkey,
  ADD CONSTRAINT pos_orders_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE public.pos_payments
  DROP CONSTRAINT IF EXISTS pos_payments_store_id_fkey,
  ADD CONSTRAINT pos_payments_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE public.qr_order_sessions
  DROP CONSTRAINT IF EXISTS qr_order_sessions_store_id_fkey,
  ADD CONSTRAINT qr_order_sessions_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE public.pos_store_settings
  DROP CONSTRAINT IF EXISTS pos_store_settings_store_id_fkey,
  ADD CONSTRAINT pos_store_settings_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE public.pos_refunds
  DROP CONSTRAINT IF EXISTS pos_refunds_store_id_fkey,
  ADD CONSTRAINT pos_refunds_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE public.pos_invoices
  DROP CONSTRAINT IF EXISTS pos_invoices_store_id_fkey,
  ADD CONSTRAINT pos_invoices_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

-- pos_transactions 是舊 POS 系統殘留，store_id nullable，CASCADE 清掉
ALTER TABLE public.pos_transactions
  DROP CONSTRAINT IF EXISTS pos_transactions_store_id_fkey,
  ADD CONSTRAINT pos_transactions_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

-- ── HR / 員工欄位：SET NULL，保留記錄只清門市關聯 ────────────
ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_store_id_fkey,
  ADD CONSTRAINT employees_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE SET NULL;

ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_store_id_fkey,
  ADD CONSTRAINT attendance_records_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE SET NULL;

ALTER TABLE public.department_manager_history
  DROP CONSTRAINT IF EXISTS department_manager_history_store_id_fkey,
  ADD CONSTRAINT department_manager_history_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE SET NULL;
