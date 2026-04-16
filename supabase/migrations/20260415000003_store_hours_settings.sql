-- 門市工時上下限設定
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS ft_monthly_hours_min INT DEFAULT 150;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS ft_monthly_hours_max INT DEFAULT 175;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS pt_monthly_hours_min INT DEFAULT 80;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS pt_monthly_hours_max INT DEFAULT 175;
