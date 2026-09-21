-- ════════════════════════════════════════════════════════════
-- 「非費用申請」支援
-- 2026-05-14
--
-- 需求：費用申請頁面的「非費用」類型原本仍走完整費用表單，
-- 應該只填「主旨 + 說明 + 附件」（不需金額/品項/科目/供應商/門市），
-- 走獨立的簽核鏈（不依金額）。
--
-- 改動：
--   1. expense_requests 加 is_expense BOOLEAN（預設 true）
--   2. estimated_amount 改 nullable（非費用沒金額）
--   3. trigger auto_apply_expense_approval_chain 區分 is_expense：
--      - true  → 依 amount 找 category='費用申請' chain（原邏輯）
--      - false → 找 category='非費用申請' active chain
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 新欄位 + 既有欄位 nullable ═══
ALTER TABLE public.expense_requests
  ADD COLUMN IF NOT EXISTS is_expense BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.expense_requests
  ALTER COLUMN estimated_amount DROP NOT NULL;

COMMENT ON COLUMN public.expense_requests.is_expense IS
  'true=費用申請（走 amount-based chain）/ false=非費用（主旨+說明+附件，走 category=非費用申請 chain）';


-- ═══ 2. 改 trigger 邏輯 ═══
CREATE OR REPLACE FUNCTION public.auto_apply_expense_approval_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_chain_id INT;
  v_amount NUMERIC;
BEGIN
  -- 使用者已手動指定就不動
  IF NEW.approval_chain_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_expense = false THEN
    -- ── 非費用：找 category='非費用申請' active chain ──
    SELECT id INTO v_chain_id
      FROM public.approval_chains
     WHERE category = '非費用申請'
       AND COALESCE(is_active, true) = true
     ORDER BY id DESC
     LIMIT 1;
  ELSE
    -- ── 費用：依 amount 找 category='費用申請' chain（原邏輯）──
    v_amount := COALESCE(NEW.estimated_amount, 0);
    SELECT id INTO v_chain_id
      FROM public.approval_chains
     WHERE category = '費用申請'
       AND COALESCE(is_active, true) = true
       AND (min_amount IS NULL OR min_amount <= v_amount)
       AND (max_amount IS NULL OR max_amount >= v_amount)
     ORDER BY COALESCE(min_amount, 0) DESC
     LIMIT 1;
  END IF;

  IF v_chain_id IS NOT NULL THEN
    NEW.approval_chain_id := v_chain_id;
  END IF;

  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
