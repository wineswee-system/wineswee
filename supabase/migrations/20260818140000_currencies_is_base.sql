-- 標記本位幣(台幣)— 讓 finance/ExchangeRates.jsx 的 foreignCurrencies 正確排除 TWD
-- ExchangeRates.jsx: `currencies.filter(c => !c.is_base)`;無此欄時 TWD 會被當外幣列出。
-- 2026-08-18. idempotent。
ALTER TABLE public.currencies ADD COLUMN IF NOT EXISTS is_base boolean NOT NULL DEFAULT false;
UPDATE public.currencies SET is_base = true  WHERE code IN ('TWD','NTD') AND is_base IS DISTINCT FROM true;
UPDATE public.currencies SET is_base = false WHERE code NOT IN ('TWD','NTD') AND is_base IS DISTINCT FROM false;

NOTIFY pgrst, 'reload schema';
