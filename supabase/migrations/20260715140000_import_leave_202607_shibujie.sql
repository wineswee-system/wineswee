-- 匯入 7 月請假 1 筆 — 2026-07-15
-- 來源:20260714請假申請明細 (1).xlsx（起訖 2026/07/01~07/31、事假、資料筆數 1）
-- 蔡沛潔(L2026122, id 419, 財務部) 2026-07-13 事假 8h,原因「家裡有事」。
-- 走既有 bulk_import_leave(內建去重,overwrite=true 可重跑)。idempotent。

SELECT public.bulk_import_leave(
  '[{"employee_id":419,"employee":"蔡沛潔","organization_id":1,"type":"事假","start_date":"2026-07-13","end_date":"2026-07-13","days":1,"hours":8,"unit":"hour","reason":"家裡有事","status":"已核准","approver":"104匯入"}]'::jsonb,
  true
) AS leave_result;
