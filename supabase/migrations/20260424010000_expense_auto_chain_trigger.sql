-- ============================================================
-- 費用申請送出時自動掛對應簽核鏈
--
-- 邏輯：
--   expense_requests INSERT 時，依 estimated_amount 去找
--   approval_chains (category='費用申請' + is_active) 的區間，
--   找到就自動填 approval_chain_id。
--
-- 使用者已手動指定 approval_chain_id 的話不覆蓋。
-- 找不到符合的鏈也不阻擋，只是留 NULL。
-- ============================================================

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

  v_amount := COALESCE(NEW.estimated_amount, 0);

  -- 找符合金額區間的鏈；min_amount 最大的優先（更精準的區間）
  SELECT id INTO v_chain_id
  FROM public.approval_chains
  WHERE category = '費用申請'
    AND COALESCE(is_active, true) = true
    AND (min_amount IS NULL OR min_amount <= v_amount)
    AND (max_amount IS NULL OR max_amount >= v_amount)
  ORDER BY COALESCE(min_amount, 0) DESC
  LIMIT 1;

  IF v_chain_id IS NOT NULL THEN
    NEW.approval_chain_id := v_chain_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_apply_expense_chain ON public.expense_requests;

CREATE TRIGGER trg_auto_apply_expense_chain
  BEFORE INSERT ON public.expense_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_apply_expense_approval_chain();

-- 回填：已存在但沒掛鏈的費用申請（只處理「申請中」或「待審」狀態的）
DO $$
DECLARE
  rec RECORD;
  v_chain_id INT;
BEGIN
  FOR rec IN SELECT id, estimated_amount FROM public.expense_requests
             WHERE approval_chain_id IS NULL AND status IN ('申請中', '待審')
  LOOP
    SELECT id INTO v_chain_id FROM public.approval_chains
    WHERE category = '費用申請'
      AND COALESCE(is_active, true) = true
      AND (min_amount IS NULL OR min_amount <= COALESCE(rec.estimated_amount, 0))
      AND (max_amount IS NULL OR max_amount >= COALESCE(rec.estimated_amount, 0))
    ORDER BY COALESCE(min_amount, 0) DESC
    LIMIT 1;
    IF v_chain_id IS NOT NULL THEN
      UPDATE public.expense_requests SET approval_chain_id = v_chain_id WHERE id = rec.id;
    END IF;
  END LOOP;
END $$;
