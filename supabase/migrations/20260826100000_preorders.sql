-- 線上預購 / 出貨SOP 表單:狀態追蹤 CRUD(未出貨/已出貨),不走簽核鏈
CREATE TABLE IF NOT EXISTS public.preorders (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   integer,
  order_date        date,
  customer_name     text NOT NULL,
  phone             text,
  address           text,
  items             jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ name, qty }] 可多筆
  need_bag          boolean NOT NULL DEFAULT false,       -- 是否提袋
  need_invoice      boolean NOT NULL DEFAULT false,       -- 是否發票統編
  invoice_tax_id    text,                                  -- 統編號碼(need_invoice 時)
  specific_delivery boolean NOT NULL DEFAULT false,       -- 是否特定送貨時間
  delivery_time     text,                                  -- 指定送貨時間(specific_delivery 時)
  notes             text,                                  -- 其他交待事項
  status            text NOT NULL DEFAULT '未出貨',        -- 未出貨 / 已出貨
  created_by        integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION public._preorders_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_preorders_touch ON public.preorders;
CREATE TRIGGER trg_preorders_touch BEFORE UPDATE ON public.preorders
  FOR EACH ROW EXECUTE FUNCTION public._preorders_touch_updated_at();

DROP TRIGGER IF EXISTS trg_preorders_set_org ON public.preorders;
CREATE TRIGGER trg_preorders_set_org BEFORE INSERT ON public.preorders
  FOR EACH ROW EXECUTE FUNCTION public.set_org_default();

-- RLS:同 org 的 staff 可讀寫(LIFF anon 走 DEFINER RPC 繞過);單一 FOR ALL policy 避免多條 OR 破洞
ALTER TABLE public.preorders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS preorders_all ON public.preorders;
CREATE POLICY preorders_all ON public.preorders FOR ALL
  USING (org_visible(organization_id) AND is_staff())
  WITH CHECK (org_visible(organization_id) AND is_staff());

-- 逐入口權限:預設發 admin/super_admin(權限頁「線上預購」開關可逐人再開)
INSERT INTO public.permissions (code, name, module, is_system, is_active)
SELECT 'nav.entry.process.preorders', '專案流程 · 線上預購', '導航 · 專案流程', true, true
WHERE NOT EXISTS (SELECT 1 FROM public.permissions WHERE code = 'nav.entry.process.preorders');

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.code = 'nav.entry.process.preorders'
  AND r.name IN ('admin', 'super_admin')
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);
