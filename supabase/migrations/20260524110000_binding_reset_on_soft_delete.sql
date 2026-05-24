-- ════════════════════════════════════════════════════════════════════════════
-- 修：軟刪表單後 binding 也要 reset 成「未填」
-- ----------------------------------------------------------------------------
-- 問題：「刪除」按鈕走 soft_delete_request RPC，只設 deleted_at（保留 60 天）
--   PG 沒真的 DELETE → 上一支 BEFORE DELETE trigger 不會 fire
--   binding 殘留「簽核中」+ form_id → LIFF 看到的還是舊狀態
--
-- 修法：AFTER UPDATE OF deleted_at trigger
--   偵測 deleted_at 從 NULL 變值 → reset binding 同樣邏輯
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 共用：偵測軟刪 → reset binding
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._reset_binding_on_form_soft_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- 只在 deleted_at 從 NULL 變值時動作
  IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.linked_binding_id IS NULL THEN RETURN NEW; END IF;

  UPDATE public.task_form_bindings
     SET status       = '未填',
         form_id      = NULL,
         completed_at = NULL
   WHERE id = NEW.linked_binding_id
     AND form_id = NEW.id;
  RETURN NEW;
END $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 1. expense_requests soft delete → reset binding
-- ═════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_exp_req_reset_on_soft_delete ON public.expense_requests;
CREATE TRIGGER trg_exp_req_reset_on_soft_delete
  AFTER UPDATE OF deleted_at ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._reset_binding_on_form_soft_delete();


-- ═════════════════════════════════════════════════════════════════════════
-- 2. expenses soft delete → reset binding
-- ═════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_exp_reset_on_soft_delete ON public.expenses;
CREATE TRIGGER trg_exp_reset_on_soft_delete
  AFTER UPDATE OF deleted_at ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._reset_binding_on_form_soft_delete();


-- ═════════════════════════════════════════════════════════════════════════
-- 3. form_submissions soft delete → reset binding
-- ═════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_form_sub_reset_on_soft_delete ON public.form_submissions;
CREATE TRIGGER trg_form_sub_reset_on_soft_delete
  AFTER UPDATE OF deleted_at ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public._reset_binding_on_form_soft_delete();


-- ═════════════════════════════════════════════════════════════════════════
-- 4. store_audits soft delete → reset binding（如果 store_audits 也有 deleted_at）
-- ═════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'store_audits'
       AND column_name = 'deleted_at'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_store_audit_reset_on_soft_delete ON public.store_audits';
    EXECUTE 'CREATE TRIGGER trg_store_audit_reset_on_soft_delete
             AFTER UPDATE OF deleted_at ON public.store_audits
             FOR EACH ROW EXECUTE FUNCTION public._reset_binding_on_form_soft_delete()';
  END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 5. 一次性 sweep：找出 form_id 指向「已軟刪」表單的 binding 全 reset
-- ═════════════════════════════════════════════════════════════════════════
-- expense_requests
UPDATE public.task_form_bindings tfb
   SET status = '未填', form_id = NULL, completed_at = NULL
 WHERE form_type = 'expense_request'
   AND form_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.expense_requests er
      WHERE er.id = tfb.form_id AND er.deleted_at IS NOT NULL
   );

-- expenses
UPDATE public.task_form_bindings tfb
   SET status = '未填', form_id = NULL, completed_at = NULL
 WHERE form_type = 'expense'
   AND form_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.expenses e
      WHERE e.id = tfb.form_id AND e.deleted_at IS NOT NULL
   );

-- form_submissions
UPDATE public.task_form_bindings tfb
   SET status = '未填', form_id = NULL, completed_at = NULL
 WHERE form_type = 'form_submission'
   AND form_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.form_submissions fs
      WHERE fs.id = tfb.form_id AND fs.deleted_at IS NOT NULL
   );

COMMIT;

NOTIFY pgrst, 'reload schema';
