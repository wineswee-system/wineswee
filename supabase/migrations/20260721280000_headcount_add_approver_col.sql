-- headcount_requests 補 approver 欄(HR B 鏈相容)— 2026-07-21
-- hr_chain_approve 對所有 HR B 表 UPDATE ... SET status, approver, reject_reason;headcount_requests
-- 缺 approver 欄 → 一旦走鏈簽核會 42703 炸(headcount 0 筆從沒跑過鏈,雷一直沒爆)。純加欄。
-- 對齊 [[feedback_shared_trigger_column_drift]]:共用函式跨表 schema 要同步。

ALTER TABLE public.headcount_requests ADD COLUMN IF NOT EXISTS approver text;

NOTIFY pgrst, 'reload schema';
