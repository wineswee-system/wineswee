-- ════════════════════════════════════════════════════════════════════════════
-- 修舊單 settle history 時間用 chain-link pattern
-- 學申請 chain 邏輯：step N entered = step (N-1) exited
--
-- #134 為例：
-- - step 0: 11:36 → 13:01（real，1h25m）
-- - step 1: entered = step 0 exited = 13:01；exited = 13:01（假設陳虹同人推進）
-- - step 2: entered = step 1 exited = 13:01；exited = settled_at（真實等韓德森時間）
--
-- 對所有歷史 settle row 做：
-- 1. step N（N>0）：entered_at = step N-1 的 exited_at（chain-link）
-- 2. 中間關卡（非最後一關）：exited_at = entered_at（duration 0，前端 hide）
-- 3. 最後一關：exited_at = req.settled_at（真實完成時間）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 用 PL/pgSQL 逐單 chain-link，因為 SQL 表達不出「reference previous row」
DO $$
DECLARE
  v_req       RECORD;
  v_step      RECORD;
  v_prev_exit TIMESTAMPTZ;
  v_max_step  INT;
  v_updated   INT := 0;
BEGIN
  FOR v_req IN
    SELECT DISTINCT er.id, er.settled_at, er.approved_at, er.status
      FROM public.expense_requests er
      JOIN public.approval_step_history h
        ON h.request_type = 'expense_settle' AND h.request_id = er.id
     WHERE er.settle_chain_id IS NOT NULL
  LOOP
    -- 拿這單最大 step_order
    SELECT MAX(step_order) INTO v_max_step
      FROM public.approval_step_history
     WHERE request_type = 'expense_settle' AND request_id = v_req.id;

    v_prev_exit := NULL;

    -- 按 step_order 升序逐關處理
    FOR v_step IN
      SELECT id, step_order, entered_at, exited_at
        FROM public.approval_step_history
       WHERE request_type = 'expense_settle' AND request_id = v_req.id
       ORDER BY step_order
    LOOP
      IF v_step.step_order = 0 THEN
        -- step 0 不動（trigger 段 A 寫的真實時間）
        v_prev_exit := v_step.exited_at;
      ELSE
        DECLARE
          v_new_entered TIMESTAMPTZ;
          v_new_exited  TIMESTAMPTZ;
        BEGIN
          -- entered_at = 前一關 exited
          v_new_entered := COALESCE(v_prev_exit, v_req.approved_at);

          -- exited_at：最後一關用 settled_at，中間關卡用 entered_at（duration 0）
          IF v_step.step_order = v_max_step AND v_req.status = '已核銷' THEN
            v_new_exited := v_req.settled_at;
          ELSE
            v_new_exited := v_new_entered;
          END IF;

          UPDATE public.approval_step_history
             SET entered_at = v_new_entered,
                 exited_at  = v_new_exited
           WHERE id = v_step.id;

          v_updated := v_updated + 1;
          v_prev_exit := v_new_exited;
        END;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'chain-link backfill 更新 % 筆 history row', v_updated;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
