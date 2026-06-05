-- ════════════════════════════════════════════════════════════════════════════
-- expense_requests.approval_chain_id 變動時自動同步 request_chain_snapshots
--
-- 問題：原 trg_snapshot_expense_request_chain 只在 AFTER INSERT 跑。
--      如果之後 chain_id 換了（例如 is_expense 切換、admin 改 chain、batch 修補），
--      snapshot 還是停在舊 chain，前端 modal/PDF 顯示錯人。
--
-- 修法：
--   1. function 改成同時處理 INSERT 跟 UPDATE
--      UPDATE 且 chain_id 真的變了 → DELETE 舊 snapshot rows，再 call helper 寫新的
--   2. trigger 改成 AFTER INSERT OR UPDATE OF approval_chain_id
--      WHEN approval_chain_id IS NOT NULL（chain 變 NULL 不重建，保留歷史）
--
-- 範圍：只動 expense_requests（per feedback_minimize_touching_existing 避免動其他表）
-- 之後其他表（leave/overtime/hr forms）有同樣需求再個別處理
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._trg_snapshot_expense_request_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- UPDATE 且 chain 真的變了 → 清掉舊 snapshot 重寫
  IF TG_OP = 'UPDATE' AND OLD.approval_chain_id IS DISTINCT FROM NEW.approval_chain_id THEN
    DELETE FROM public.request_chain_snapshots
     WHERE request_type = 'expense_request'
       AND request_id   = NEW.id;
  END IF;

  PERFORM public._snapshot_chain_for_request(
    'expense_request', NEW.id, NEW.approval_chain_id
  );
  RETURN NEW;
END $$;

-- 重掛 trigger：INSERT + UPDATE OF approval_chain_id
DROP TRIGGER IF EXISTS trg_snapshot_expense_request_chain ON public.expense_requests;
CREATE TRIGGER trg_snapshot_expense_request_chain
  AFTER INSERT OR UPDATE OF approval_chain_id ON public.expense_requests
  FOR EACH ROW
  WHEN (NEW.approval_chain_id IS NOT NULL)
  EXECUTE FUNCTION public._trg_snapshot_expense_request_chain();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 健檢
DO $$
DECLARE
  v_trigger_def TEXT;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_trigger_def
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'expense_requests'
     AND t.tgname  = 'trg_snapshot_expense_request_chain';
  RAISE NOTICE 'trg_snapshot_expense_request_chain 已更新：%', v_trigger_def;
END $$;
