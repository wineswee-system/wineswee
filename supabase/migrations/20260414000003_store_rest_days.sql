-- Add per-store monthly rest day settings
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS ft_monthly_rest_days INT DEFAULT 8;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS pt_monthly_rest_days INT DEFAULT 14;

COMMENT ON COLUMN store_settings.ft_monthly_rest_days IS '正職每月休假天數';
COMMENT ON COLUMN store_settings.pt_monthly_rest_days IS '兼職每月休假天數';
