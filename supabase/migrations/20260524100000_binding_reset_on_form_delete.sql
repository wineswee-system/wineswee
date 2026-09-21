-- ════════════════════════════════════════════════════════════════════════════
-- 修：表單被刪除後，task_form_bindings 殘留 form_id 還顯示「簽核中」
-- ----------------------------------------------------------------------------
-- 問題：
--   task_form_bindings.form_id 是 INT 沒設 FK，所以刪 expense_request / expense
--   / form_submission / store_audit 時 PG 不會自動清掉 binding 的關聯。
--   結果：LIFF 看任務還顯示「簽核中」，但表單其實已經沒了。
--
-- 修法：
--   1. 每張 form 表加 BEFORE DELETE trigger：
--      找對應 binding (linked_binding_id) → 重置 status='未填'、form_id=NULL
--   2. 一次性掃描：把 form_id 指向已刪 row 的 binding 全 reset
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 共用：reset binding 函式
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._reset_binding_on_form_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.linked_binding_id IS NULL THEN RETURN OLD; END IF;
  UPDATE public.task_form_bindings
     SET status       = '未填',
         form_id      = NULL,
         completed_at = NULL
   WHERE id = OLD.linked_binding_id
     AND form_id = OLD.id;  -- 只有當 binding 真的指這張 form 才重設
  RETURN OLD;
END $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 1. expense_requests 刪除 → reset binding
-- ═════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_exp_req_reset_binding_on_delete ON public.expense_requests;
CREATE TRIGGER trg_exp_req_reset_binding_on_delete
  BEFORE DELETE ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._reset_binding_on_form_delete();


-- ═════════════════════════════════════════════════════════════════════════
-- 2. expenses 刪除 → reset binding
-- ═════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_exp_reset_binding_on_delete ON public.expenses;
CREATE TRIGGER trg_exp_reset_binding_on_delete
  BEFORE DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._reset_binding_on_form_delete();


-- ═════════════════════════════════════════════════════════════════════════
-- 3. form_submissions 刪除 → reset binding
-- ═════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_form_sub_reset_binding_on_delete ON public.form_submissions;
CREATE TRIGGER trg_form_sub_reset_binding_on_delete
  BEFORE DELETE ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public._reset_binding_on_form_delete();


-- ═════════════════════════════════════════════════════════════════════════
-- 4. store_audits 刪除 → reset binding（如果 store_audit 也加進 binding 範圍）
-- ═════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_store_audit_reset_binding_on_delete ON public.store_audits;
CREATE TRIGGER trg_store_audit_reset_binding_on_delete
  BEFORE DELETE ON public.store_audits
  FOR EACH ROW EXECUTE FUNCTION public._reset_binding_on_form_delete();


-- ═════════════════════════════════════════════════════════════════════════
-- 5. 一次性掃描：把 form_id 指向「已不存在 row」的 binding 全 reset
-- ═════════════════════════════════════════════════════════════════════════
-- expense_request 類
UPDATE public.task_form_bindings tfb
   SET status = '未填', form_id = NULL, completed_at = NULL
 WHERE form_type = 'expense_request'
   AND form_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.expense_requests er WHERE er.id = tfb.form_id);

-- expense 類
UPDATE public.task_form_bindings tfb
   SET status = '未填', form_id = NULL, completed_at = NULL
 WHERE form_type = 'expense'
   AND form_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = tfb.form_id);

-- form_submission 類
UPDATE public.task_form_bindings tfb
   SET status = '未填', form_id = NULL, completed_at = NULL
 WHERE form_type = 'form_submission'
   AND form_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.form_submissions fs WHERE fs.id = tfb.form_id);

-- store_audit 類
UPDATE public.task_form_bindings tfb
   SET status = '未填', form_id = NULL, completed_at = NULL
 WHERE form_type = 'store_audit'
   AND form_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.store_audits sa WHERE sa.id = tfb.form_id);

COMMIT;

NOTIFY pgrst, 'reload schema';
