-- 清掉 leave_balances 裡錯的「補休」列（年度假勤補休改讀 comp_time_ledger,這批髒的沒用了)
-- 2026-07-13  leave_balances 的 補休(如陳佩璇 total_days11.9=95h)與 104(3.5h)/comp_time_ledger 對不上。
--   年度假勤補休列已改讀 comp_time_ledger(權威),此批 leave_balances 補休刪除避免混淆。idempotent。

DELETE FROM public.leave_balances WHERE year = 2026 AND leave_type = '補休';

NOTIFY pgrst, 'reload schema';
