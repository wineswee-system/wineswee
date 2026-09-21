-- ════════════════════════════════════════════════════════════════════════════
-- 修兩件：
-- 1. trg_log_settle_step_history 跟 trg_snapshot_expense_settle_chain
--    順序錯（兩個都 AFTER UPDATE，按字母順序 log<snapshot）
--    → 新單送核銷時 log 先跑，snapshot 還沒寫 → step 0 label 永遠 NULL
-- 2. backfill 那些 row 的 entered_at = approved_at（placeholder）+
--    exited_at = settled_at → 顯示「停留 7 天 21 小時」誤導
--    改成 entered_at = exited_at（duration=0，前端不顯示「停留」）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Rename log trigger → trg_z_ 前綴確保最後跑 ───
DROP TRIGGER IF EXISTS trg_log_settle_step_history ON public.expense_requests;
DROP TRIGGER IF EXISTS trg_z_log_settle_step_history ON public.expense_requests;
CREATE TRIGGER trg_z_log_settle_step_history
  AFTER UPDATE ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_log_settle_step_history();


-- ─── 2. 修 backfill 的誤導時間：把 entered_at=approved_at 的 row
--        改成 entered_at=exited_at（duration=0） ───
UPDATE public.approval_step_history h
   SET entered_at = h.exited_at
  FROM public.expense_requests er
 WHERE h.request_type = 'expense_settle'
   AND h.request_id   = er.id
   AND h.step_order   > 0                 -- step 0 是 trigger 段 A 寫的，時間真實
   AND h.entered_at   = er.approved_at    -- 這 row 是 backfill 寫的
   AND h.exited_at IS NOT NULL            -- 只動有 exit time 的
   AND h.exited_at   > h.entered_at;      -- 防回頭

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 健檢
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM pg_trigger
   WHERE tgname IN ('trg_z_log_settle_step_history','trg_snapshot_expense_settle_chain')
     AND tgrelid = 'public.expense_requests'::regclass;
  RAISE NOTICE 'expense_requests 上的 AFTER UPDATE trigger（按字母）共 % 個', v_count;
END $$;
