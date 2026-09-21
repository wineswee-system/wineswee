-- Add bank detail fields and passbook image to employees table
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS bank_name           TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch         TEXT,
  ADD COLUMN IF NOT EXISTS passbook_image_url  TEXT;

COMMENT ON COLUMN employees.bank_name          IS '銀行名稱（例：台灣銀行）';
COMMENT ON COLUMN employees.bank_branch        IS '分行名稱（例：忠孝分行）';
COMMENT ON COLUMN employees.passbook_image_url IS '存摺封面圖片 URL（儲存於 employee-docs bucket）';
