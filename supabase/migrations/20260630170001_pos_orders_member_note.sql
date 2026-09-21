-- pos_orders: 加 member_id（會員綁定）
-- note 欄位原本已存在，無需新增
-- 2026-06-30

ALTER TABLE public.pos_orders
  ADD COLUMN IF NOT EXISTS member_id INT REFERENCES public.members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_orders_member ON public.pos_orders(member_id);

NOTIFY pgrst, 'reload schema';
