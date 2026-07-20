-- 修:改短簽核鏈後,在飛的經常性費用卡在「已移除的關」→ status 永遠待審核 — 2026-07-20
-- 背景:chain 25 原 4 關,單子走到 current_step=3(停第4關);老闆後來移掉一關→chain 剩 3 關,
--   current_step=3 指到不存在的關 → expense_step_advance 回 STEP_NOT_FOUND,誰都推不動。
--   現有關(0/1/2)歷史全 approved → 視為簽完,補結成已核銷。
-- 安全:只動 current_step >= 現有關數 的單(代表現有關都已通過);current_step 只在通過時才前進。
-- idempotent:已核銷的不再進迴圈(只掃待審核)。

DO $$
DECLARE
  r       RECORD;
  v_total INT;
BEGIN
  FOR r IN
    SELECT id, approval_chain_id, current_step
    FROM public.expenses
    WHERE status = '待審核' AND approval_chain_id IS NOT NULL
  LOOP
    SELECT COUNT(*) INTO v_total
    FROM public.approval_chain_steps WHERE chain_id = r.approval_chain_id;

    -- current_step 越界(鏈被縮短)→ 現有關都簽過 → 補結案
    IF r.current_step >= v_total THEN
      UPDATE public.expenses
        SET status = '已核銷', current_step = v_total
        WHERE id = r.id;

      -- 清掉指向「已移除關」的幽靈 pending 歷史(step_order 越界)
      DELETE FROM public.approval_step_history
        WHERE request_type = 'expense' AND request_id = r.id
          AND step_order >= v_total AND action = 'pending';

      RAISE NOTICE 'expense #% 補結案(鏈縮短殘留,已現有關數=%)', r.id, v_total;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
