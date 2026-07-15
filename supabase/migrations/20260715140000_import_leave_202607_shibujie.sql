-- 匯入 7 月請假 1 筆 — 2026-07-15
-- 來源:20260714請假申請明細 (1).xlsx（起訖 2026/07/01~07/31、事假、資料筆數 1）
-- 蔡沛潔(L2026122, id 419, 財務部) 2026-07-13 事假 8h,原因「家裡有事」。
-- 走既有 bulk_import_leave(內建去重,overwrite=true 可重跑)。idempotent。

SELECT public.bulk_import_leave(
  '[{"employee_id":419,"employee":"蔡沛潔","organization_id":1,"type":"事假","start_date":"2026-07-13","end_date":"2026-07-13","days":1,"hours":8,"unit":"hour","reason":"家裡有事","status":"已核准","approver":"104匯入"}]'::jsonb,
  true
) AS leave_result;

-- bulk_import_leave 只加假單、不會連動 leave_balances 的 used_days。
-- 蔡沛潔事假現有 2 筆(7/14 id174 + 7/13 id220 各 1 天),但餘額 used 只記 1 天 → 重算對齊。
-- 依「該員該年已核准事假的 days 合計」重算,idempotent(重跑=相同值,不加倍)。
UPDATE public.leave_balances lb
   SET used_days = (
         SELECT COALESCE(SUM(lr.days), 0)
           FROM public.leave_requests lr
          WHERE lr.employee_id = 419
            AND lr.type   = '事假'
            AND lr.status = '已核准'
            AND EXTRACT(YEAR FROM lr.start_date) = lb.year
       ),
       updated_at = now()
 WHERE lb.employee_id = 419
   AND lb.leave_type  = 'personal';
