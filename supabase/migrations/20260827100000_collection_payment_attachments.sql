-- 收款每筆錢可附匯款證明(訂金/加盟金 payment 各加附件欄)
ALTER TABLE public.deposit_payments      ADD COLUMN IF NOT EXISTS attachment_path text, ADD COLUMN IF NOT EXISTS attachment_name text;
ALTER TABLE public.franchise_fee_payments ADD COLUMN IF NOT EXISTS attachment_path text, ADD COLUMN IF NOT EXISTS attachment_name text;
