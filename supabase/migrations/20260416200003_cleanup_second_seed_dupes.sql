-- ============================================================
-- Cleanup: 刪除 seed 重複執行產生的第二批重複資料
-- departments 29-37, stores 35-46, employees 156-167
-- ============================================================

BEGIN;

-- Delete duplicate employees from second seed run (if any)
DELETE FROM employees WHERE id >= 156 AND organization_id = 1
  AND name IN ('Cherry','Anita','蘇東瑜','Vicky','Molly','Zoey','Alicia','Grace','Danny','楊學文','花輪','阿謙')
  AND id NOT IN (144,145,146,147,148,149,150,151,152,153,154,155);

-- Delete duplicate stores from second seed run
DELETE FROM stores WHERE id >= 35 AND id <= 46;

-- Delete duplicate departments from second seed run
DELETE FROM departments WHERE id >= 29 AND id <= 37;

-- Update 總經理室 dept head (was missed in cleanup)
UPDATE departments SET head = '總經理室' WHERE id = 19 AND head IS NULL;

COMMIT;
