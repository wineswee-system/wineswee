-- ════════════════════════════════════════════════════════════════════════════
-- inventory_valuations 回填 organization_id + 上 RLS（org 對齊收斂漏網之魚）
-- 2026-07-05
--
-- 背景：20260618110000 批次補 org 欄位時未涵蓋 inventory_valuations；
--   20260705170000_inventory_monthly_close 補了欄位（新快照會寫 org），但
--   (1) 既有 row 未回填、(2) 無 BEFORE INSERT trigger、(3) 全表無 RLS —
--   任何登入者可讀全部組織的存貨評價快照（營業成本表期初/期末存貨來源）。
--
-- 做法（比照 20260618110000 house pattern）：
--   1) 回填：優先由 sku_id → skus.organization_id；殘餘 null → 唯一 org（MIN）
--   2) BEFORE INSERT trigger set_org_default：新 row 沒帶 org 自動補
--   3) RLS：SELECT 限同 org（org_visible）；寫保持寬鬆（不擋月結寫入流程）
--
-- idempotent：UPDATE 僅補 null、DROP TRIGGER/POLICY IF EXISTS。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 回填：由 SKU 主檔帶出 org
UPDATE public.inventory_valuations iv
   SET organization_id = s.organization_id
  FROM public.skus s
 WHERE iv.sku_id = s.id
   AND iv.organization_id IS NULL;

-- 殘餘（sku 遺失/無 org）→ 唯一 org fallback
UPDATE public.inventory_valuations
   SET organization_id = (SELECT MIN(id) FROM public.organizations)
 WHERE organization_id IS NULL;

-- 新 row 自動補 org（共用 20260618110000 的 set_org_default）
DROP TRIGGER IF EXISTS trg_set_org_default ON public.inventory_valuations;
CREATE TRIGGER trg_set_org_default
  BEFORE INSERT ON public.inventory_valuations
  FOR EACH ROW EXECUTE FUNCTION public.set_org_default();

CREATE INDEX IF NOT EXISTS idx_inventory_valuations_org_date
  ON public.inventory_valuations (organization_id, valuation_date);

-- RLS：讀限同 org、寫寬鬆（同 20260618 批次原則，月結 RPC 寫入不受影響）
ALTER TABLE public.inventory_valuations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_valuations_org_sel ON public.inventory_valuations;
CREATE POLICY inventory_valuations_org_sel ON public.inventory_valuations
  FOR SELECT USING (org_visible(organization_id));
DROP POLICY IF EXISTS inventory_valuations_ins ON public.inventory_valuations;
CREATE POLICY inventory_valuations_ins ON public.inventory_valuations
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS inventory_valuations_upd ON public.inventory_valuations;
CREATE POLICY inventory_valuations_upd ON public.inventory_valuations
  FOR UPDATE USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS inventory_valuations_del ON public.inventory_valuations;
CREATE POLICY inventory_valuations_del ON public.inventory_valuations
  FOR DELETE USING (true);

COMMIT;

NOTIFY pgrst, 'reload schema';
