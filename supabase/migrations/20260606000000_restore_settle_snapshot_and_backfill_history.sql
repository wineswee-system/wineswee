-- ════════════════════════════════════════════════════════════════════════════
-- 修補：trg_snapshot_expense_settle_chain 不在 DB + history 漏寫補
--
-- 發現：
-- 1. 段 A 查 pg_trigger 發現 trg_snapshot_expense_settle_chain 不存在
--    （20260601120000 migration 沒跑成 / 或被手動 DROP 過）
-- 2. 因此送核銷時 request_chain_snapshots 沒被寫
-- 3. _trg_log_settle_step_history 段 B (推進到下一關) 要求
--    v_snap_label IS NOT NULL 才 INSERT → snapshot 沒有 → 步驟 1+ 沒寫
-- 4. 結果：modal 顯示前 1 關 + 最後一關有時間，中間都空白
--
-- 修法：
-- A. 重建 trg_snapshot_expense_settle_chain trigger
-- B. backfill：對所有 settle_chain_id IS NOT NULL 但無 snapshot 的單補 snapshot
-- C. backfill step_history：用 snapshot 的 label 填回缺的 step_history rows
--    （時間不準，用 settled_at 當 placeholder；只補 step_label / target_type 等元資料）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── A. 重建 trigger ───
DROP TRIGGER IF EXISTS trg_snapshot_expense_settle_chain ON public.expense_requests;
CREATE TRIGGER trg_snapshot_expense_settle_chain
  AFTER UPDATE ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_snapshot_expense_settle_chain();


-- ─── B. backfill：補所有 settle_chain_id IS NOT NULL 但沒 snapshot 的單 ───
DO $$
DECLARE
  v_req RECORD;
  v_count INT := 0;
BEGIN
  FOR v_req IN
    SELECT id, settle_chain_id, employee_id
      FROM public.expense_requests
     WHERE status IN ('待核銷', '已核銷', '核銷已退回')
       AND settle_chain_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.request_chain_snapshots
          WHERE request_type = 'expense_settle' AND request_id = expense_requests.id
       )
  LOOP
    PERFORM public._snapshot_settle_chain(v_req.id, v_req.settle_chain_id, v_req.employee_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'backfill snapshot：% 張單補了快照', v_count;
END $$;


-- ─── C. backfill step_history：把 snapshot 已建的單，補上缺的 step_history 元資料 ───
-- 注意：這只補「結構」不補「時間」。中間關卡的 entered_at/exited_at 沒地方查只能 NULL。
-- 唯一準的是最後一關 exited_at = settled_at。
DO $$
DECLARE
  v_req RECORD;
  v_snap RECORD;
  v_existing INT;
  v_inserted INT := 0;
BEGIN
  FOR v_req IN
    SELECT id, settle_chain_id, settle_current_step, status, settled_at, organization_id
      FROM public.expense_requests
     WHERE status IN ('待核銷', '已核銷', '核銷已退回')
       AND settle_chain_id IS NOT NULL
  LOOP
    FOR v_snap IN
      SELECT step_order, label, target_type
        FROM public.request_chain_snapshots
       WHERE request_type = 'expense_settle' AND request_id = v_req.id
       ORDER BY step_order
    LOOP
      SELECT COUNT(*) INTO v_existing
        FROM public.approval_step_history
       WHERE request_type = 'expense_settle'
         AND request_id   = v_req.id
         AND step_order   = v_snap.step_order;

      IF v_existing = 0 THEN
        INSERT INTO public.approval_step_history (
          request_type, request_id, organization_id, chain_id,
          step_order, step_label, target_type,
          entered_at, exited_at, action
        ) VALUES (
          'expense_settle', v_req.id, v_req.organization_id, v_req.settle_chain_id,
          v_snap.step_order, v_snap.label, v_snap.target_type,
          -- entered/exited 填 NULL（沒記錄），最後一關 exited_at 用 settled_at
          NULL,
          CASE
            WHEN v_req.status = '已核銷'
             AND v_snap.step_order = (
               SELECT MAX(step_order) FROM public.request_chain_snapshots
                WHERE request_type='expense_settle' AND request_id = v_req.id
             )
            THEN v_req.settled_at
            ELSE NULL
          END,
          CASE
            WHEN v_req.status = '已核銷' AND v_snap.step_order <= v_req.settle_current_step THEN 'approved'
            WHEN v_req.status = '核銷已退回' AND v_snap.step_order = v_req.settle_current_step THEN 'rejected'
            WHEN v_snap.step_order < v_req.settle_current_step THEN 'approved'
            WHEN v_snap.step_order = v_req.settle_current_step THEN 'pending'
            ELSE NULL
          END
        );
        v_inserted := v_inserted + 1;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'backfill step_history：補 % 筆 row（時間部分多為 NULL，僅最後一關有 settled_at）', v_inserted;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 健檢
DO $$
DECLARE
  v_trig_exists BOOL;
  v_snap_count INT;
  v_hist_count INT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_snapshot_expense_settle_chain'
  ) INTO v_trig_exists;
  RAISE NOTICE 'trg_snapshot_expense_settle_chain 現況：%', v_trig_exists;

  SELECT COUNT(DISTINCT request_id) INTO v_snap_count
    FROM public.request_chain_snapshots WHERE request_type = 'expense_settle';
  RAISE NOTICE '有 snapshot 的核銷單：% 張', v_snap_count;

  SELECT COUNT(DISTINCT request_id) INTO v_hist_count
    FROM public.approval_step_history WHERE request_type = 'expense_settle';
  RAISE NOTICE '有 step_history 的核銷單：% 張', v_hist_count;
END $$;
