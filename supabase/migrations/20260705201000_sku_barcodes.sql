-- ============================================================
-- 20260705201000_sku_barcodes.sql
-- F-C4 條碼主檔（PLAN_fin-tax-inv_2026-07-04 三/F-C4）
--
-- 1. sku_barcodes — 一品多碼主檔（GTIN-13 / 店內碼 / 秤重碼）
--    - UNIQUE(organization_id, barcode)：同組織條碼不得重複
--    - 部分唯一索引：每個 SKU 僅一個主要條碼（is_primary）
-- 2. org RLS（org_visible，同 20260705120000 慣例）
-- 3. 回填：skus.barcode 既有單欄條碼 → sku_barcodes（店內碼、主要）
--
-- 型別備註：skus.id 為 SERIAL（INT）→ sku_id 用 INT；
--          organizations.id 為 BIGSERIAL → organization_id 用 BIGINT。
-- 電商/物流整合明確不在本次範圍（僅條碼主檔）。
--
-- 冪等：可重複執行。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sku_barcodes (
  id              BIGSERIAL   PRIMARY KEY,
  organization_id BIGINT      NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sku_id          INT         NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  barcode         TEXT        NOT NULL CHECK (btrim(barcode) <> ''),
  type            TEXT        NOT NULL DEFAULT '店內碼'
                              CHECK (type IN ('GTIN-13', '店內碼', '秤重碼')),
  is_primary      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, barcode)
);

COMMENT ON TABLE public.sku_barcodes IS
  '條碼主檔（F-C4）：一品多碼。秤重碼存 5 碼品號（掃描時由 lib/barcode.js 解析 13 碼秤重條碼取品號比對）';
COMMENT ON COLUMN public.sku_barcodes.type IS
  'GTIN-13＝國際條碼（檢查碼驗證）｜店內碼＝自編碼｜秤重碼＝2 開頭 13 碼（品號＋價格/重量）';

-- 每個 SKU 僅允許一個主要條碼
CREATE UNIQUE INDEX IF NOT EXISTS sku_barcodes_one_primary_per_sku
  ON public.sku_barcodes (sku_id)
  WHERE is_primary;

-- org + barcode 掃碼熱路徑已由 UNIQUE 覆蓋；補 sku 維度列表查詢
CREATE INDEX IF NOT EXISTS sku_barcodes_sku_id_idx
  ON public.sku_barcodes (sku_id);

-- ═══ RLS ═══

ALTER TABLE public.sku_barcodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sku_barcodes_org_sel ON public.sku_barcodes;
CREATE POLICY sku_barcodes_org_sel ON public.sku_barcodes
  FOR SELECT TO authenticated
  USING (org_visible(organization_id));

DROP POLICY IF EXISTS sku_barcodes_org_ins ON public.sku_barcodes;
CREATE POLICY sku_barcodes_org_ins ON public.sku_barcodes
  FOR INSERT TO authenticated
  WITH CHECK (org_visible(organization_id));

DROP POLICY IF EXISTS sku_barcodes_org_upd ON public.sku_barcodes;
CREATE POLICY sku_barcodes_org_upd ON public.sku_barcodes
  FOR UPDATE TO authenticated
  USING (org_visible(organization_id))
  WITH CHECK (org_visible(organization_id));

DROP POLICY IF EXISTS sku_barcodes_org_del ON public.sku_barcodes;
CREATE POLICY sku_barcodes_org_del ON public.sku_barcodes
  FOR DELETE TO authenticated
  USING (org_visible(organization_id));

-- ═══ 回填：skus.barcode 既有條碼 → 條碼主檔 ═══
-- type 統一「店內碼」（依計畫；型別可於 UI 事後修正）；
-- 該 SKU 尚無主要條碼時標 is_primary（NOT EXISTS 讓重跑不撞 one_primary 索引）；
-- organization_id 為 NULL 的孤兒 SKU 跳過（org RLS 前提）。

INSERT INTO public.sku_barcodes (organization_id, sku_id, barcode, type, is_primary)
SELECT
  s.organization_id::BIGINT,
  s.id,
  btrim(s.barcode),
  '店內碼',
  NOT EXISTS (
    SELECT 1 FROM public.sku_barcodes b
    WHERE b.sku_id = s.id AND b.is_primary
  )
FROM public.skus s
WHERE s.barcode IS NOT NULL
  AND btrim(s.barcode) <> ''
  AND s.organization_id IS NOT NULL
ON CONFLICT (organization_id, barcode) DO NOTHING;

NOTIFY pgrst, 'reload schema';
