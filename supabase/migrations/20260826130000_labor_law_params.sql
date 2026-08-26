-- 法令工資設定「基本工資 / 勞退提繳率」改讀 DB(逐年,可用 API/後台更新,不再寫死前端)。
-- 全域法定值(非 org 範疇),比照 nhi_supplement_params:RLS 開、authenticated 可讀、寫走 service_role/API。
CREATE TABLE IF NOT EXISTS public.labor_law_params (
  effective_year        int PRIMARY KEY,
  min_wage_monthly      numeric NOT NULL,
  min_wage_hourly       numeric NOT NULL,
  pension_employer_rate numeric NOT NULL DEFAULT 0.06,
  created_at            timestamptz DEFAULT now()
);
ALTER TABLE public.labor_law_params ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labor_law_params_sel ON public.labor_law_params;
CREATE POLICY labor_law_params_sel ON public.labor_law_params FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.labor_law_params TO authenticated, anon, service_role;

INSERT INTO public.labor_law_params (effective_year, min_wage_monthly, min_wage_hourly, pension_employer_rate)
VALUES (2025, 28590, 190, 0.06), (2026, 29500, 196, 0.06)
ON CONFLICT (effective_year) DO NOTHING;
