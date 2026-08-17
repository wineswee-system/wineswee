-- 維修單擴充:①獨立的「維修廠商」庫(跟採購 suppliers 分開)②可自訂「維修類別」③repair_orders 掛 category_id/vendor_id。
-- RLS 比照 repair_orders:current_employee_has_permission('repair_order.manage') + org_visible。LIFF 走 DEFINER RPC 讀,不靠 anon RLS。

-- ── 維修廠商 ──
CREATE TABLE IF NOT EXISTS public.repair_vendors (
  id              serial PRIMARY KEY,
  organization_id int,
  name            text NOT NULL,
  specialty       text,                         -- 專長/類型(如 水電、冷氣)
  contact_person  text,
  phone           text,
  note            text,
  status          text NOT NULL DEFAULT '啟用',  -- 啟用 / 停用
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── 維修類別(可自訂) ──
CREATE TABLE IF NOT EXISTS public.repair_categories (
  id              serial PRIMARY KEY,
  organization_id int,
  name            text NOT NULL,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── repair_orders 掛欄 ──
ALTER TABLE public.repair_orders ADD COLUMN IF NOT EXISTS category_id      int REFERENCES public.repair_categories(id) ON DELETE SET NULL;
ALTER TABLE public.repair_orders ADD COLUMN IF NOT EXISTS repair_vendor_id int REFERENCES public.repair_vendors(id)    ON DELETE SET NULL;

-- ── org 預設 ──
DROP TRIGGER IF EXISTS trg_set_org_default ON public.repair_vendors;
CREATE TRIGGER trg_set_org_default BEFORE INSERT ON public.repair_vendors    FOR EACH ROW EXECUTE FUNCTION public.set_org_default();
DROP TRIGGER IF EXISTS trg_set_org_default ON public.repair_categories;
CREATE TRIGGER trg_set_org_default BEFORE INSERT ON public.repair_categories FOR EACH ROW EXECUTE FUNCTION public.set_org_default();

-- ── RLS ──
ALTER TABLE public.repair_vendors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repair_vendors_manage ON public.repair_vendors;
CREATE POLICY repair_vendors_manage ON public.repair_vendors FOR ALL TO authenticated
  USING (current_employee_has_permission('repair_order.manage') AND org_visible(organization_id))
  WITH CHECK (current_employee_has_permission('repair_order.manage') AND org_visible(organization_id));
DROP POLICY IF EXISTS repair_vendors_service ON public.repair_vendors;
CREATE POLICY repair_vendors_service ON public.repair_vendors FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS repair_categories_manage ON public.repair_categories;
CREATE POLICY repair_categories_manage ON public.repair_categories FOR ALL TO authenticated
  USING (current_employee_has_permission('repair_order.manage') AND org_visible(organization_id))
  WITH CHECK (current_employee_has_permission('repair_order.manage') AND org_visible(organization_id));
DROP POLICY IF EXISTS repair_categories_service ON public.repair_categories;
CREATE POLICY repair_categories_service ON public.repair_categories FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 種子:每個 org 一份常用類別(冪等) ──
INSERT INTO public.repair_categories (organization_id, name, sort_order)
SELECT o.id, c.name, c.ord
  FROM public.organizations o
  CROSS JOIN (VALUES ('水電',1),('冷氣',2),('招牌',3),('門窗',4),('清潔',5),('消防',6),('設備',7),('其他',99)) AS c(name, ord)
 WHERE NOT EXISTS (SELECT 1 FROM public.repair_categories rc WHERE rc.organization_id = o.id AND rc.name = c.name);
