-- 叫貨月結發票登記表:純登記 + 統計(月份 / 廠商 / 金額 / 附件最多10),不走簽核鏈。
-- 附件直接存 jsonb(避開 form_attachments RLS),檔案上 expense-receipts bucket。比照 preorders 樣板。
CREATE TABLE IF NOT EXISTS public.monthly_invoices (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   integer,
  invoice_month     text NOT NULL,                        -- 'YYYY-MM'
  vendor            text NOT NULL,                        -- 廠商(純文字)
  amount            numeric NOT NULL DEFAULT 0,
  note              text,
  attachments       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ path, name, mime, size }] 最多10
  created_by        integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_monthly_invoices_org_month
  ON public.monthly_invoices(organization_id, invoice_month) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public._monthly_invoices_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_monthly_invoices_touch ON public.monthly_invoices;
CREATE TRIGGER trg_monthly_invoices_touch BEFORE UPDATE ON public.monthly_invoices
  FOR EACH ROW EXECUTE FUNCTION public._monthly_invoices_touch_updated_at();

DROP TRIGGER IF EXISTS trg_monthly_invoices_set_org ON public.monthly_invoices;
CREATE TRIGGER trg_monthly_invoices_set_org BEFORE INSERT ON public.monthly_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_org_default();

-- RLS:同 org 的 staff 可讀寫;單一 FOR ALL policy 避免多條 OR 破洞
ALTER TABLE public.monthly_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS monthly_invoices_all ON public.monthly_invoices;
CREATE POLICY monthly_invoices_all ON public.monthly_invoices FOR ALL
  USING (org_visible(organization_id) AND is_staff())
  WITH CHECK (org_visible(organization_id) AND is_staff());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_invoices TO authenticated;
