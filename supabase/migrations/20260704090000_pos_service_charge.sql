-- ============================================================
-- 20260704090000_pos_service_charge.sql
-- 內用桌邊結帳服務費
--
-- 1. pos_store_settings.service_charge_pct — 門市服務費 %（預設 10）
-- 2. pos_orders.service_charge            — 本單實收服務費金額
-- ============================================================

ALTER TABLE pos_store_settings
  ADD COLUMN IF NOT EXISTS service_charge_pct NUMERIC(5,2) DEFAULT 10;

ALTER TABLE pos_orders
  ADD COLUMN IF NOT EXISTS service_charge NUMERIC(10,2) DEFAULT 0;
