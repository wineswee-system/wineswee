-- =============================================
-- 個人時數上限（每 cycle）
-- 主要給兼職用：店長可以指定「小明這個 cycle 最多 80h」之類
-- NULL = 沒設個人上限，走店面預設 (ft/pt_monthly_hours_max)
-- =============================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS personal_hour_cap INTEGER;

COMMENT ON COLUMN employees.personal_hour_cap IS
  '個人每 cycle 時數上限 (NULL = 用店面預設)';
