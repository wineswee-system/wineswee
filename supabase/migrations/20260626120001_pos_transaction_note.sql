-- Add order note to pos_transactions
ALTER TABLE public.pos_transactions
  ADD COLUMN IF NOT EXISTS note TEXT;
