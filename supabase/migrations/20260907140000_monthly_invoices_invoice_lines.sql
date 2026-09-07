-- 月結發票登記:一個廠商當月可能多張發票,加 invoice_lines jsonb[{number,amount}] 存各張明細。
-- amount 欄仍存加總(對帳讀 amount 不變)。additive,不動既有。
ALTER TABLE public.monthly_invoices ADD COLUMN IF NOT EXISTS invoice_lines jsonb DEFAULT '[]'::jsonb;
