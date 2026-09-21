-- ════════════════════════════════════════════════════════════════════════════
-- 費用申請 is_expense 切換時自動重算 approval_chain_id
--
-- 問題：auto_apply_expense_approval_chain trigger 只在 BEFORE INSERT 跑。
--      員工編輯重送時把「費用 ↔ 非費用」切換，is_expense 變了但 chain_id 沒重算
--      → 例如 #186 原本送「非費用」(chain 21)，編輯改「費用」→ is_expense=true
--        但 chain_id 還停在 21 → 簽核流程顯示錯人
--
-- 修法：把 trigger 從「BEFORE INSERT」改成「BEFORE INSERT OR UPDATE OF is_expense」
--      function 加判斷：
--        UPDATE 且 is_expense 真的變了 → 強制清掉 chain_id 重抓
--        其他情境（手動指定 chain、is_expense 沒變）→ 原邏輯
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.auto_apply_expense_approval_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_chain_id INT;
  v_amount   NUMERIC;
  v_force    BOOLEAN := false;
BEGIN
  -- 編輯時切換 is_expense → 強制重抓 chain（覆蓋舊的）
  IF TG_OP = 'UPDATE' AND OLD.is_expense IS DISTINCT FROM NEW.is_expense THEN
    NEW.approval_chain_id := NULL;
    v_force := true;
  END IF;

  -- 已手動指定 chain 不動（force=true 跳過此判斷因為剛已 NULL）
  IF NOT v_force AND NEW.approval_chain_id IS NOT NULL THEN
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
    -- ── 費用：依 amount 找 category='費用申請' chain ──
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

-- 重掛 trigger：INSERT + UPDATE OF is_expense（type 一變就重算）
DROP TRIGGER IF EXISTS trg_auto_apply_expense_chain ON public.expense_requests;
CREATE TRIGGER trg_auto_apply_expense_chain
  BEFORE INSERT OR UPDATE OF is_expense ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public.auto_apply_expense_approval_chain();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── 修 #186（黃蘊珊）+ 順便補 employee_id ───
-- 該單目前狀態：is_expense=true, estimated=3150, chain=21（應該套 8/9/10）
-- 同時 employee_id=null 也補上（黃蘊珊 id=148，從 #185 比對得知）
DO $$
DECLARE
  v_chain INT;
  v_count INT;
BEGIN
  -- 找符合 3150 的費用 chain
  SELECT id INTO v_chain
    FROM public.approval_chains
   WHERE category = '費用申請'
     AND COALESCE(is_active, true) = true
     AND (min_amount IS NULL OR min_amount <= 3150)
     AND (max_amount IS NULL OR max_amount >= 3150)
   ORDER BY COALESCE(min_amount, 0) DESC
   LIMIT 1;

  IF v_chain IS NOT NULL THEN
    UPDATE public.expense_requests
       SET approval_chain_id = v_chain,
           employee_id       = COALESCE(employee_id, 148),  -- 黃蘊珊
           current_step      = 0  -- 重置回第 0 關（重新簽核）
     WHERE id = 186
       AND status = '申請中';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE '#186 修正：% 筆 row 更新，chain → %', v_count, v_chain;
  ELSE
    RAISE NOTICE '#186 找不到對應的費用 chain（3150）— 請手動處理';
  END IF;
END $$;
