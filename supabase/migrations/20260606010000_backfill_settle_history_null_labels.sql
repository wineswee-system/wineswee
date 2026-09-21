-- ════════════════════════════════════════════════════════════════════════════
-- 補：approval_step_history 中 expense_settle 已存在但 step_label = NULL 的 row
-- 用 request_chain_snapshots 的 label 填回
-- （那些 row 是 _trg_log_settle_step_history 段 A 在 snapshot 沒寫時 insert 的）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.approval_step_history h
   SET step_label  = s.label,
       target_type = COALESCE(h.target_type, s.target_type)
  FROM public.request_chain_snapshots s
 WHERE h.request_type = 'expense_settle'
   AND s.request_type = 'expense_settle'
   AND h.request_id   = s.request_id
   AND h.step_order   = s.step_order
   AND h.step_label IS NULL
   AND s.label IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_null INT;
BEGIN
  SELECT COUNT(*) INTO v_null
    FROM public.approval_step_history
   WHERE request_type = 'expense_settle' AND step_label IS NULL;
  RAISE NOTICE 'expense_settle history 還有 % 筆 step_label = NULL', v_null;
END $$;
