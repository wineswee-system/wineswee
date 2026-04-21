-- 所有門市改為四週變形 + 正職休10天 + 兼職休假天數依週工時
-- 若 store_settings 不存在則 insert，存在則 update

INSERT INTO store_settings (store_id, work_hour_system, ft_monthly_rest_days, pt_monthly_rest_days)
SELECT id, '4週變形', 10, 15
FROM stores
ON CONFLICT (store_id)
DO UPDATE SET
  work_hour_system = '4週變形',
  ft_monthly_rest_days = 10;
