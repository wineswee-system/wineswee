-- ════════════════════════════════════════════════════════════════════════════
-- 幣別單一來源表 currencies
-- 2026-06-23
--
-- 目的:以後新增幣別只要在這張表 INSERT 一列,全系統(前端下拉/符號 + LINE flex 卡片)
--   自動帶出,不用再改 6~7 個地方。
-- 後續:flex 函式改查此表(20260623130000);expense_requests.currency 改 FK 參照此表。
-- idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.currencies (
  code       TEXT PRIMARY KEY,                 -- 'TWD'
  name       TEXT NOT NULL,                    -- '台幣'
  symbol     TEXT NOT NULL,                    -- 'NT$'（顯示在金額前）
  decimals   INT  NOT NULL DEFAULT 0,          -- 小數位(TWD/JPY=0, 其餘=2)
  sort_order INT  NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- seed（含既有 5 種 + 新 NZD/AUD）
INSERT INTO public.currencies (code, name, symbol, decimals, sort_order) VALUES
  ('TWD', '台幣',     'NT$', 0, 1),
  ('USD', '美元',     'US$', 2, 2),
  ('JPY', '日幣',     '¥',   0, 3),
  ('CNY', '人民幣',   '¥',   2, 4),
  ('EUR', '歐元',     '€',   2, 5),
  ('NZD', '紐西蘭幣', 'NZ$', 2, 6),
  ('AUD', '澳幣',     'A$',  2, 7)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, symbol = EXCLUDED.symbol, decimals = EXCLUDED.decimals,
  sort_order = EXCLUDED.sort_order, is_active = true;

-- RLS:參考資料,登入者 + anon(LIFF)皆可讀;寫入僅 admin
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS currencies_read ON public.currencies;
CREATE POLICY currencies_read ON public.currencies FOR SELECT TO authenticated, anon USING (true);
DROP POLICY IF EXISTS currencies_admin_write ON public.currencies;
CREATE POLICY currencies_admin_write ON public.currencies FOR ALL TO authenticated
  USING (public.current_employee_role() IN ('admin','super_admin'))
  WITH CHECK (public.current_employee_role() IN ('admin','super_admin'));
GRANT SELECT ON public.currencies TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.currencies TO authenticated;

-- expense_requests.currency 改成參照 currencies(取代寫死的 CHECK)
ALTER TABLE public.expense_requests DROP CONSTRAINT IF EXISTS chk_expense_request_currency;
ALTER TABLE public.expense_requests DROP CONSTRAINT IF EXISTS fk_expense_request_currency;
ALTER TABLE public.expense_requests
  ADD CONSTRAINT fk_expense_request_currency
  FOREIGN KEY (currency) REFERENCES public.currencies(code);

-- LIFF anon 取幣別清單
CREATE OR REPLACE FUNCTION public.list_currencies()
RETURNS SETOF public.currencies
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.currencies WHERE is_active ORDER BY sort_order, code;
$$;
GRANT EXECUTE ON FUNCTION public.list_currencies() TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
