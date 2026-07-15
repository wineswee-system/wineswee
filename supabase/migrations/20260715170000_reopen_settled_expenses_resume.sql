-- 退回沒簽完就被標已核銷的經常性費用 → 從斷點接著簽 — 2026-07-15
-- 根因:這8張是被直接標成「已核銷」(approver/approved_by=null),沒走完整簽核鏈;
--   approval_step_history 裡後面幾關(執行長/總經理/財務)完全沒紀錄。
-- 做法:status 打回待審核 + current_step 設到「第一個沒簽的關」,保留部門主管已簽的紀錄。
--   執行長起接著簽,expense_step_advance 會正常逐關推進+記錄。idempotent。

-- 部門主管已簽(step0)的 → 退回執行長(step 1)
UPDATE public.expenses
   SET status = '待審核', current_step = 1, approver = NULL, approved_by = NULL
 WHERE id IN (24, 25, 31, 32, 33, 34, 35) AND approval_chain_id = 25;

-- #14 完全沒簽 + 沒綁 chain → 補綁費用報銷鏈(25) + 退回部門主管(step 0)
UPDATE public.expenses
   SET status = '待審核', current_step = 0, approval_chain_id = 25, approver = NULL, approved_by = NULL
 WHERE id = 14;

NOTIFY pgrst, 'reload schema';
