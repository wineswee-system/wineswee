-- 財務經理換人:在飛「申請中」費用單的財務會簽關卡仍凍住舊指向(陳虹 52,寫死+舊代簽標籤),
-- 範本已改動態綁財務部經理(→王慧甄 440),但舊單開單當下已凍結不漂移(系統設計)。
-- 手動回填:把還沒經過的財務關 target_emp_id 52→440(新財務經理王慧甄),label 去掉過時的「(Zoey代)」。
-- 守門:①只動 org1 ②只動 target_emp_id=52 的舊指向(冪等,重跑不再變)③只動 step_order>=current_step(已核准關卡不碰)④只換人不加關。
UPDATE public.request_chain_snapshots s
   SET target_emp_id = 440,
       label = '財務會簽'
  FROM public.expense_requests r
 WHERE s.request_type = 'expense_request'
   AND s.request_id   = r.id
   AND r.organization_id = 1
   AND r.status = '申請中'
   AND s.target_type = 'fixed_emp'
   AND s.target_emp_id = 52
   AND s.label ILIKE '%財務%'
   AND s.step_order >= r.current_step;
