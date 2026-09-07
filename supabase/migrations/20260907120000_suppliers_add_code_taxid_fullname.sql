-- 叫貨申請廠商主檔:補 code(廠商代號)/tax_id(統一編號)/full_name(全名)三欄,
-- 供 Excel 廠商清單匯入保存完整資訊(原 suppliers 只有 name)。additive nullable,不動既有欄位/code。
-- 另加 (organization_id, code) 唯一索引防重複匯入。資料本身(37 筆/org 1)以一次性 SQL 匯入,不放本檔。
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS tax_id text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS full_name text;
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_code_uniq
  ON public.suppliers(organization_id, code) WHERE code IS NOT NULL;
