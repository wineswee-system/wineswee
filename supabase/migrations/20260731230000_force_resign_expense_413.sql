-- 強制 #413 非經常性費用申請 rewind 到 step0,讓張庭瑋(主管初核)重新簽 — 2026-07-31
-- ════════════════════════════════════════════════════════════════════════════
-- #413(申請人羅紹輝)目前 current_step=1(卡在陳虹執行長複核),step0 主管初核張庭瑋
-- 已簽。需求:讓張庭瑋重新簽 → 把鏈退回 step0。
-- 羅紹輝直屬主管=張庭瑋(emp62),step0=applicant_supervisor 會解到她;status 維持
-- 「申請中」(不觸發 resubmit-reset trigger)。改 current_step 會自動:①ASH trigger 記
-- 歷史 ②delegate trigger 發 LINE 通知張庭瑋該她簽。
-- 另清掉舊簽核歷史 → timeline 從 step0 重新開始(否則會顯示她「已簽 08:44」)。
-- 一次性、綁死 id=413,guard current_step=1(重跑不會亂動)。
-- ════════════════════════════════════════════════════════════════════════════

-- 1) 退回 step0(status 不動;approved_by 清掉)
UPDATE public.expense_requests
   SET current_step = 0, approved_by = NULL, approved_at = NULL
 WHERE id = 413 AND current_step = 1;

-- 2) 清掉 #413 舊簽核歷史(含上面 UPDATE 觸發 ASH trigger 補的),timeline 重來
DELETE FROM public.approval_step_history
 WHERE request_type = 'expense_request' AND request_id = 413;

-- 3) 重寫 step0「進站/待簽」一筆(讓 timeline 顯示這關現在在等張庭瑋簽)
INSERT INTO public.approval_step_history
  (request_type, request_id, organization_id, chain_id, step_order, step_label, target_type, entered_at, action)
SELECT 'expense_request', 413, er.organization_id, er.approval_chain_id, 0,
       cs.label, cs.target_type, NOW(), 'pending'
FROM public.expense_requests er
LEFT JOIN public.approval_chain_steps cs
       ON cs.chain_id = er.approval_chain_id AND cs.step_order = 0
WHERE er.id = 413;

NOTIFY pgrst, 'reload schema';
