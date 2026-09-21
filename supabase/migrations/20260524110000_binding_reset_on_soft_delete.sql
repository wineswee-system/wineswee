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
-- 1~4. 全部 4 張表都用 DO block 偵測 deleted_at 欄位才掛 trigger
--      (expenses 沒這欄位，全包起來防 schema drift)
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  tbl  TEXT;
  trig TEXT;
BEGIN
  FOR tbl, trig IN VALUES
    ('expense_requests',  'trg_exp_req_reset_on_soft_delete'),
    ('expenses',          'trg_exp_reset_on_soft_delete'),
    ('form_submissions',  'trg_form_sub_reset_on_soft_delete'),
    ('store_audits',      'trg_store_audit_reset_on_soft_delete')
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = tbl
         AND column_name = 'deleted_at'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trig, tbl);
      EXECUTE format('CREATE TRIGGER %I
                      AFTER UPDATE OF deleted_at ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION public._reset_binding_on_form_soft_delete()',
                     trig, tbl);
      RAISE NOTICE '✓ trigger 已掛: %.%', tbl, trig;
    ELSE
      RAISE NOTICE '⊘ skip %（沒 deleted_at 欄位）', tbl;
    END IF;
  END LOOP;
END $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 5. 一次性 sweep：把 form_id 指向已軟刪 row 的 binding 全 reset
--    每張表都用 DO block 確認有 deleted_at 才跑
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  tbl       TEXT;
  form_type TEXT;
BEGIN
  FOR tbl, form_type IN VALUES
    ('expense_requests',  'expense_request'),
    ('expenses',          'expense'),
    ('form_submissions',  'form_submission'),
    ('store_audits',      'store_audit')
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = tbl
         AND column_name = 'deleted_at'
    ) THEN
      EXECUTE format('
        UPDATE public.task_form_bindings tfb
           SET status = %L, form_id = NULL, completed_at = NULL
         WHERE form_type = %L
           AND form_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM public.%I r
              WHERE r.id = tfb.form_id AND r.deleted_at IS NOT NULL
           )', '未填', form_type, tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
