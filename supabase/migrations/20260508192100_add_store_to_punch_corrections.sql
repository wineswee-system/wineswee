-- Web 用 punch_corrections 表（LIFF 用 clock_corrections）— 兩個並行
-- 192000 加了 store 給 clock_corrections，這支補加 punch_corrections
ALTER TABLE public.punch_corrections ADD COLUMN IF NOT EXISTS store TEXT;
NOTIFY pgrst, 'reload schema';
