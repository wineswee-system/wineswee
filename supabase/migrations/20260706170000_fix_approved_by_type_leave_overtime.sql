-- 修：請假/加班 審核到「最後一關核准」或「駁回」時跳錯
--     column "approved_by" is of type integer but expression is of type text
-- 2026-07-06
-- 根因：leave_requests / overtime_requests 的 approved_by 是 INTEGER（schema drift），
--   但 liff_approve_request / web_advance_chain_request 核准/駁回寫的是 emp.name（TEXT）
--   → 型別衝突。中間關卡推進(SET current_step)不碰 approved_by 故「有些可以簽有些不行」。
--   其餘表(clock_corrections/expenses/business_trips/expense_requests)的 approved_by 已是 TEXT。
-- 修法：把這兩張的 approved_by 改成 TEXT（放審核人姓名），對齊 RPC 與其他表。
--   既有整數值 ::text 保留。idempotent（只在目前仍是 integer 時才改）。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='leave_requests'
       AND column_name='approved_by' AND data_type IN ('integer','bigint','smallint')
  ) THEN
    ALTER TABLE public.leave_requests    ALTER COLUMN approved_by TYPE TEXT USING approved_by::text;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='overtime_requests'
       AND column_name='approved_by' AND data_type IN ('integer','bigint','smallint')
  ) THEN
    ALTER TABLE public.overtime_requests ALTER COLUMN approved_by TYPE TEXT USING approved_by::text;
  END IF;
END $$;
