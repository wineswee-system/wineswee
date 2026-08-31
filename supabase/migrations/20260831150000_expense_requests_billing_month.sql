-- 叫貨申請單月結對帳:加「帳務月份」欄(決定這張叫貨算哪個月的帳,月結常跨月故不用申請日)。
-- 只對 doc_type='order' 使用;費用申請(expense)不填。格式 'YYYY-MM'。
ALTER TABLE public.expense_requests ADD COLUMN IF NOT EXISTS billing_month text;
CREATE INDEX IF NOT EXISTS idx_expense_requests_billing
  ON public.expense_requests(organization_id, supplier, billing_month)
  WHERE doc_type = 'order' AND deleted_at IS NULL;
