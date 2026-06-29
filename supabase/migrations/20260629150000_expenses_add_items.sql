-- 經常性費用加品項明細欄
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]';

NOTIFY pgrst, 'reload schema';
