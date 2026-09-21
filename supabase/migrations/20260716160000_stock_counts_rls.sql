-- 補 stock_counts RLS(裸表無 RLS → 任何人可讀寫全 org 盤點) — 2026-07-16
-- 資安健檢抓到唯一裸表。照 org_visible 慣例(同 sku_barcodes)開 4 條 org policy + 收 anon。
-- idempotent。

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_counts_org_sel ON public.stock_counts;
CREATE POLICY stock_counts_org_sel ON public.stock_counts
  FOR SELECT TO authenticated
  USING (org_visible(organization_id));

DROP POLICY IF EXISTS stock_counts_org_ins ON public.stock_counts;
CREATE POLICY stock_counts_org_ins ON public.stock_counts
  FOR INSERT TO authenticated
  WITH CHECK (org_visible(organization_id));

DROP POLICY IF EXISTS stock_counts_org_upd ON public.stock_counts;
CREATE POLICY stock_counts_org_upd ON public.stock_counts
  FOR UPDATE TO authenticated
  USING (org_visible(organization_id))
  WITH CHECK (org_visible(organization_id));

DROP POLICY IF EXISTS stock_counts_org_del ON public.stock_counts;
CREATE POLICY stock_counts_org_del ON public.stock_counts
  FOR DELETE TO authenticated
  USING (org_visible(organization_id));

-- 盤點是後台 staff 功能,anon 完全不該碰
REVOKE ALL ON TABLE public.stock_counts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_counts TO authenticated;

NOTIFY pgrst, 'reload schema';
