-- 修：請假/加班 審核到「最後一關核准」或「駁回」時跳錯
--     column "approved_by" is of type integer but expression is of type text
-- 2026-07-06
-- 根因：leave_requests / overtime_requests 的 approved_by 被 20260418000002 加成
--   INT REFERENCES employees(id)。但 liff_approve_request/web_advance 核准/駁回寫的是
--   emp.name(TEXT)，前端(exportPdf / ExpenseRequests)也是 {name: req.approved_by} 當「姓名」用
--   → 欄位型別(int FK) 與 實際用途(text 姓名) 不符 → 型別衝突。
--   中間關卡推進(SET current_step)不碰 approved_by 故「有些可以簽有些不行」。
--   其餘表(clock_corrections/expenses/business_trips/expense_requests)的 approved_by 已是 TEXT。
-- 修法：拆掉誤加的 FK + 把 approved_by 改成 TEXT（放審核人姓名），對齊 RPC/前端/其他表。
--   既有數字值 ::text 保留，再把純數字的舊值還原成員工姓名。idempotent。

-- 1) 拆掉 approved_by 上的外鍵（動態找，避免約束名不同）
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass::text AS tbl
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     WHERE c.contype = 'f'
       AND c.conrelid IN ('public.leave_requests'::regclass, 'public.overtime_requests'::regclass)
       AND a.attname = 'approved_by'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- 2) 型別 integer → text（僅在仍是整數時）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
       AND table_name='leave_requests' AND column_name='approved_by'
       AND data_type IN ('integer','bigint','smallint')) THEN
    ALTER TABLE public.leave_requests    ALTER COLUMN approved_by TYPE TEXT USING approved_by::text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
       AND table_name='overtime_requests' AND column_name='approved_by'
       AND data_type IN ('integer','bigint','smallint')) THEN
    ALTER TABLE public.overtime_requests ALTER COLUMN approved_by TYPE TEXT USING approved_by::text;
  END IF;
END $$;

-- 3) 舊資料：把純數字的 approved_by（原本是 emp id）還原成員工姓名，跟新資料一致
UPDATE public.leave_requests    r SET approved_by = e.name
  FROM public.employees e WHERE r.approved_by ~ '^[0-9]+$' AND e.id = r.approved_by::int;
UPDATE public.overtime_requests r SET approved_by = e.name
  FROM public.employees e WHERE r.approved_by ~ '^[0-9]+$' AND e.id = r.approved_by::int;
