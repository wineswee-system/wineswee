-- ════════════════════════════════════════════════════════════════════════════
-- 叫貨申請單 簽核鏈:配鏈 trigger 依 doc_type 區分 category
-- 2026-06-25  Phase B
--
-- doc_type='order'(叫貨)→ 優先找 category '叫貨申請'/'叫貨-非費用申請'/'叫貨驗收' chain;
--   找不到 → fallback 用 '費用申請'/'非費用申請'/'費用核銷'(所以叫貨「先跟費用一樣」即可用)。
-- doc_type='expense' → 行為完全不變。
-- 之後 admin 在簽核鏈設定建一條叫貨 chain,就會自動接手(不用自動複製、不冒險動 schema)。
-- 完整重現原函式邏輯,只加 doc_type 分支 + fallback。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 申請配鏈 ──
CREATE OR REPLACE FUNCTION public.auto_apply_expense_approval_chain()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_chain_id INT;
  v_amount   NUMERIC;
  v_force    BOOLEAN := false;
  v_order    BOOLEAN := (NEW.doc_type = 'order');
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.is_expense IS DISTINCT FROM NEW.is_expense THEN
    NEW.approval_chain_id := NULL;
    v_force := true;
  END IF;
  IF NOT v_force AND NEW.approval_chain_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_expense = false THEN
    IF v_order THEN
      SELECT id INTO v_chain_id FROM public.approval_chains
       WHERE category = '叫貨-非費用申請' AND COALESCE(is_active, true) = true
       ORDER BY id DESC LIMIT 1;
    END IF;
    IF v_chain_id IS NULL THEN
      SELECT id INTO v_chain_id FROM public.approval_chains
       WHERE category = '非費用申請' AND COALESCE(is_active, true) = true
       ORDER BY id DESC LIMIT 1;
    END IF;
  ELSE
    v_amount := COALESCE(NEW.estimated_amount, 0);
    IF v_order THEN
      SELECT id INTO v_chain_id FROM public.approval_chains
       WHERE category = '叫貨申請' AND COALESCE(is_active, true) = true
         AND (min_amount IS NULL OR min_amount <= v_amount)
         AND (max_amount IS NULL OR max_amount >= v_amount)
       ORDER BY COALESCE(min_amount, 0) DESC LIMIT 1;
    END IF;
    IF v_chain_id IS NULL THEN
      SELECT id INTO v_chain_id FROM public.approval_chains
       WHERE category = '費用申請' AND COALESCE(is_active, true) = true
         AND (min_amount IS NULL OR min_amount <= v_amount)
         AND (max_amount IS NULL OR max_amount >= v_amount)
       ORDER BY COALESCE(min_amount, 0) DESC LIMIT 1;
    END IF;
  END IF;

  IF v_chain_id IS NOT NULL THEN
    NEW.approval_chain_id := v_chain_id;
  END IF;
  RETURN NEW;
END $$;

-- ── 核銷配鏈 ──
CREATE OR REPLACE FUNCTION public.auto_apply_expense_settle_chain()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_chain_id INT;
  v_amount   NUMERIC;
  v_order    BOOLEAN := (NEW.doc_type = 'order');
BEGIN
  IF NEW.status IS DISTINCT FROM '待核銷' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = '待核銷' THEN RETURN NEW; END IF;
  IF NEW.settle_chain_id IS NOT NULL THEN RETURN NEW; END IF;

  v_amount := COALESCE(NEW.actual_amount, NEW.estimated_amount, 0);

  IF v_order THEN
    SELECT id INTO v_chain_id FROM public.approval_chains
     WHERE category = '叫貨驗收' AND COALESCE(is_active, true) = true
       AND (min_amount IS NULL OR min_amount <= v_amount)
       AND (max_amount IS NULL OR max_amount >= v_amount)
     ORDER BY COALESCE(min_amount, 0) DESC LIMIT 1;
  END IF;
  IF v_chain_id IS NULL THEN
    SELECT id INTO v_chain_id FROM public.approval_chains
     WHERE category = '費用核銷' AND COALESCE(is_active, true) = true
       AND (min_amount IS NULL OR min_amount <= v_amount)
       AND (max_amount IS NULL OR max_amount >= v_amount)
     ORDER BY COALESCE(min_amount, 0) DESC LIMIT 1;
  END IF;

  IF v_chain_id IS NOT NULL THEN
    NEW.settle_chain_id := v_chain_id;
    NEW.settle_current_step := 0;
  END IF;
  RETURN NEW;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
