-- 稽核單整張共用照片區 — 2026-07-15
-- 除了「扣分項」可各自附照片外,再給整張單一個共用照片欄(最多20張)。idempotent。

ALTER TABLE public.store_audits ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
