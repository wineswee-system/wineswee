-- 時段人力需求加上 max_count 欄位（required_count 作為最低，max_count 作為上限）
ALTER TABLE store_time_slots
  ADD COLUMN IF NOT EXISTS max_count integer;

COMMENT ON COLUMN store_time_slots.max_count IS '時段最大人數（null=不限）。required_count 為最低人數';
