-- 緊急聯絡人加「與本人關係」欄位
-- 前端 entitySchemas.js 早就宣告了這欄但 DB 沒對應，本 migration 補上
BEGIN;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS emergency_contact_relation TEXT;

COMMENT ON COLUMN public.employees.emergency_contact_relation IS
  '緊急聯絡人關係（父母 / 配偶 / 子女 / 兄弟姊妹 / 祖父母 / 親戚 / 朋友 / 其他）';

COMMIT;
