-- ============================================================
-- 20260705170000_pos_invoices_random_code.sql
-- 電子發票隨機碼（證明聯列印 / 中獎兌獎用，4 碼數字）
-- 由 issue-invoice edge function 於開立時產生並寫入。
-- ============================================================

ALTER TABLE pos_invoices
  ADD COLUMN IF NOT EXISTS random_code TEXT;
