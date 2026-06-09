-- ════════════════════════════════════════════════════════════════════════════
-- 商品調撥申請單 — Schema
--
-- 兩階段流程：
--   申請階段：status='申請審核中' → 走 apply_chain → '待驗收'
--   驗收階段：員工填實收 + 上傳附件 → '驗收審核中' → 走 receipt_chain → '已完成'
--
-- 任何階段被駁回 → '已駁回'，員工可編輯重送
--
-- 簽核 chain 配置（不在這個 migration 建，由 seed 處理）：
--   申請鏈—總倉→門市：申請人 → applicant_supervisor → warehouse_supervisor
--   申請鏈—門市↔門市：申請人(=調入店長) → transfer_out_store_manager
--                       → transfer_in_store_supervisor → transfer_out_store_supervisor
--   驗收鏈：申請人 → applicant_supervisor
--
-- Snapshot request_type:
--   'goods_transfer_apply'   申請階段
--   'goods_transfer_receipt' 驗收階段
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 主表 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.goods_transfer_requests (
  id              SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_no     TEXT,  -- TR-YYYYMM-NNNN，trigger 自動生成

  -- 申請人
  applicant_id    INT NOT NULL REFERENCES public.employees(id),
  applicant_name  TEXT,
  applicant_dept  TEXT,
  applicant_store TEXT,

  -- 時間
  request_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  needed_date     DATE,

  -- 調撥類型 + 對象
  transfer_type   TEXT NOT NULL
    CHECK (transfer_type IN ('warehouse_to_store', 'store_to_store', 'store_to_warehouse')),
  from_store_id   INT REFERENCES public.stores(id),  -- 總倉時 NULL
  to_store_id     INT REFERENCES public.stores(id),  -- 總倉時 NULL
  from_label      TEXT,  -- 顯示用「總倉」/「門市名」
  to_label        TEXT,

  -- 原因
  reasons         TEXT[] NOT NULL DEFAULT '{}',
  reason_other    TEXT,

  -- 附件（申請/驗收分開）
  attachments         JSONB NOT NULL DEFAULT '[]',
  receipt_attachments JSONB NOT NULL DEFAULT '[]',

  -- 狀態：草稿 / 申請審核中 / 待驗收 / 驗收審核中 / 已完成 / 已駁回 / 已撤回
  status TEXT NOT NULL DEFAULT '申請審核中'
    CHECK (status IN ('草稿','申請審核中','待驗收','驗收審核中','已完成','已駁回','已撤回')),

  -- Chain tracking（current 跟著 status 切換用）
  apply_chain_id    INT REFERENCES public.approval_chains(id) ON DELETE SET NULL,
  receipt_chain_id  INT REFERENCES public.approval_chains(id) ON DELETE SET NULL,
  current_chain_id  INT REFERENCES public.approval_chains(id) ON DELETE SET NULL,  -- 目前在走哪條
  current_step      INT NOT NULL DEFAULT 0,
  current_stage     TEXT CHECK (current_stage IN ('apply', 'receipt')),

  -- 簽核紀錄
  apply_approver_id    INT REFERENCES public.employees(id) ON DELETE SET NULL,
  apply_approved_at    TIMESTAMPTZ,
  receipt_submitted_at TIMESTAMPTZ,  -- 員工送驗收時間
  receipt_approver_id  INT REFERENCES public.employees(id) ON DELETE SET NULL,
  receipt_approved_at  TIMESTAMPTZ,
  reject_reason        TEXT,
  rejected_at          TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by INT REFERENCES public.employees(id) ON DELETE SET NULL,

  UNIQUE (organization_id, document_no)
);

CREATE INDEX IF NOT EXISTS idx_gtr_org_status ON public.goods_transfer_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_gtr_applicant ON public.goods_transfer_requests(applicant_id);
CREATE INDEX IF NOT EXISTS idx_gtr_from_store ON public.goods_transfer_requests(from_store_id);
CREATE INDEX IF NOT EXISTS idx_gtr_to_store ON public.goods_transfer_requests(to_store_id);
CREATE INDEX IF NOT EXISTS idx_gtr_request_date ON public.goods_transfer_requests(request_date);

COMMENT ON TABLE public.goods_transfer_requests IS
  '商品調撥申請單 — 兩階段（申請審核 + 驗收審核）';


-- ─── 2. 商品明細 ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.goods_transfer_items (
  id SERIAL PRIMARY KEY,
  transfer_request_id INT NOT NULL REFERENCES public.goods_transfer_requests(id) ON DELETE CASCADE,
  line_no       INT NOT NULL,
  product_code  TEXT NOT NULL,
  product_name  TEXT NOT NULL,
  spec          TEXT,
  unit          TEXT,
  requested_qty NUMERIC(12,2) NOT NULL CHECK (requested_qty > 0),
  received_qty  NUMERIC(12,2),  -- 驗收時填，可能比申請少（缺貨）或多（多送）
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (transfer_request_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_gti_request ON public.goods_transfer_items(transfer_request_id, line_no);


-- ─── 3. document_no 自動生成 trigger ─────────────────────────────────────
-- 格式：TR-YYYYMM-NNNN（每月歸零，per organization）
CREATE OR REPLACE FUNCTION public.trg_goods_transfer_doc_no()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_ym  TEXT;
  v_seq INT;
BEGIN
  IF NEW.document_no IS NOT NULL AND NEW.document_no <> '' THEN
    RETURN NEW;
  END IF;
  v_ym := to_char(COALESCE(NEW.request_date, CURRENT_DATE), 'YYYYMM');

  SELECT COALESCE(MAX(
    NULLIF(substring(document_no FROM 'TR-' || v_ym || '-(\d+)$'), '')::INT
  ), 0) + 1
    INTO v_seq
    FROM goods_transfer_requests
   WHERE organization_id = NEW.organization_id
     AND document_no LIKE 'TR-' || v_ym || '-%';

  NEW.document_no := 'TR-' || v_ym || '-' || LPAD(v_seq::TEXT, 4, '0');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_goods_transfer_doc_no ON public.goods_transfer_requests;
CREATE TRIGGER trg_goods_transfer_doc_no
  BEFORE INSERT ON public.goods_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_goods_transfer_doc_no();


-- ─── 4. updated_at 自動更新 ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_goods_transfer_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_goods_transfer_touch ON public.goods_transfer_requests;
CREATE TRIGGER trg_goods_transfer_touch
  BEFORE UPDATE ON public.goods_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_goods_transfer_touch_updated_at();


-- ─── 5. RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.goods_transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_transfer_items    ENABLE ROW LEVEL SECURITY;

-- 主表：同 org 可讀，admin/manager/super_admin 全讀，員工讀自己跟自己門市的
DROP POLICY IF EXISTS gtr_read ON public.goods_transfer_requests;
CREATE POLICY gtr_read ON public.goods_transfer_requests
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS gtr_insert ON public.goods_transfer_requests;
CREATE POLICY gtr_insert ON public.goods_transfer_requests
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS gtr_update ON public.goods_transfer_requests;
CREATE POLICY gtr_update ON public.goods_transfer_requests
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
    )
    OR auth.role() = 'service_role'
  );

-- 明細表：跟主表同步授權（join 檢查）
DROP POLICY IF EXISTS gti_read ON public.goods_transfer_items;
CREATE POLICY gti_read ON public.goods_transfer_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.goods_transfer_requests r
       WHERE r.id = transfer_request_id
         AND (r.organization_id IN (
               SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
             ) OR auth.role() = 'service_role')
    )
  );

DROP POLICY IF EXISTS gti_write ON public.goods_transfer_items;
CREATE POLICY gti_write ON public.goods_transfer_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.goods_transfer_requests r
       WHERE r.id = transfer_request_id
         AND (r.organization_id IN (
               SELECT organization_id FROM employees WHERE auth_user_id = auth.uid()
             ) OR auth.role() = 'service_role')
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
