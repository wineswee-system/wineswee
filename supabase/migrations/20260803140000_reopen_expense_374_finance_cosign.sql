-- 重開費用申請 #374 財務會簽關 → 張庭瑋重簽（撤銷誤駁「重複」）— 2026-08-03
-- ════════════════════════════════════════════════════════════════════════════
-- 現況:expense_requests #374,chain 9,status=已駁回,current_step=3,reject_reason=重複。
--   chain 9 step3 =「財務會簽(Vicky代)」= 固定 emp 62（張庭瑋），非代簽、
--   approval_step_history 空、無 settle/workflow 牽連。駁回狀態只在本列。
--
-- 目標:只重開「財務會簽」這一關讓張庭瑋重簽;step1 陳虹、step2 韓德森核准保留不動。
--
-- 地雷:_trg_chain_reset_step_resubmit_ext(BEFORE UPDATE)在「已駁回→申請中」時會把
--   current_step 打回 0（整鏈重跑）。故拆兩段:
--   段1 status→申請中 + 清 reject_reason（此時 reset trigger 把 step 打到 0;
--        AFTER notify 不發，因 current_step 沒「增加」）。
--   段2 current_step→3（此時 OLD.status 已是申請中 → 不觸發 reset;current_step 0→3
--        「增加」→ AFTER notify 推「💳 財務會簽 待你審核」LINE 給張庭瑋 emp62）。
--   包在 DO 區塊 = 單一語句 → Studio 下原子執行（避免只跑到段1的半殘狀態）。
--
-- 只改這一列資料;不動任何 function/trigger。idempotent（重跑無作用、不重發 LINE）。
-- ════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- 段1:撤銷駁回,回到在飛狀態（reset trigger 會把 step 打回 0）
  UPDATE public.expense_requests
     SET status = '申請中', reject_reason = NULL
   WHERE id = 374 AND status = '已駁回';

  -- 段2:把關卡拉回財務會簽 step3 → 觸發 AFTER notify 推 LINE 給張庭瑋
  UPDATE public.expense_requests
     SET current_step = 3
   WHERE id = 374 AND status = '申請中' AND current_step <> 3;
END $$;
