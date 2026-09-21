-- 勞退月提繳分級表(勞動部 114/11/24 勞動福3字第1140153598號令,115/1/1 生效,共62級,上限150000)
CREATE TABLE IF NOT EXISTS public.labor_pension_brackets (
  year         integer NOT NULL,
  grade        integer NOT NULL,
  min_salary   numeric NOT NULL,   -- 實際工資下限(該級起)
  monthly_wage numeric NOT NULL,   -- 月提繳工資(四捨後)
  PRIMARY KEY (year, grade)
);

DELETE FROM public.labor_pension_brackets WHERE year=2026;
INSERT INTO public.labor_pension_brackets (year, grade, min_salary, monthly_wage) VALUES
  (2026,1,0,1500),
  (2026,2,1501,3000),
  (2026,3,3001,4500),
  (2026,4,4501,6000),
  (2026,5,6001,7500),
  (2026,6,7501,8700),
  (2026,7,8701,9900),
  (2026,8,9901,11100),
  (2026,9,11101,12540),
  (2026,10,12541,13500),
  (2026,11,13501,15840),
  (2026,12,15841,16500),
  (2026,13,16501,17280),
  (2026,14,17281,17880),
  (2026,15,17881,19047),
  (2026,16,19048,20008),
  (2026,17,20009,21009),
  (2026,18,21010,22000),
  (2026,19,22001,23100),
  (2026,20,23101,24000),
  (2026,21,24001,25250),
  (2026,22,25251,26400),
  (2026,23,26401,27600),
  (2026,24,27601,28590),
  (2026,25,28591,29500),
  (2026,26,29501,30300),
  (2026,27,30301,31800),
  (2026,28,31801,33300),
  (2026,29,33301,34800),
  (2026,30,34801,36300),
  (2026,31,36301,38200),
  (2026,32,38201,40100),
  (2026,33,40101,42000),
  (2026,34,42001,43900),
  (2026,35,43901,45800),
  (2026,36,45801,48200),
  (2026,37,48201,50600),
  (2026,38,50601,53000),
  (2026,39,53001,55400),
  (2026,40,55401,57800),
  (2026,41,57801,60800),
  (2026,42,60801,63800),
  (2026,43,63801,66800),
  (2026,44,66801,69800),
  (2026,45,69801,72800),
  (2026,46,72801,76500),
  (2026,47,76501,80200),
  (2026,48,80201,83900),
  (2026,49,83901,87600),
  (2026,50,87601,92100),
  (2026,51,92101,96600),
  (2026,52,96601,101100),
  (2026,53,101101,105600),
  (2026,54,105601,110100),
  (2026,55,110101,115500),
  (2026,56,115501,120900),
  (2026,57,120901,126300),
  (2026,58,126301,131700),
  (2026,59,131701,137100),
  (2026,60,137101,142500),
  (2026,61,142501,147900),
  (2026,62,147901,150000);

ALTER TABLE public.labor_pension_brackets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labor_pension_brackets_read ON public.labor_pension_brackets;
CREATE POLICY labor_pension_brackets_read ON public.labor_pension_brackets FOR SELECT USING (true);

-- 把實際工資四捨到「第一個 >= 該工資」的月提繳工資;超過最高級→150000
CREATE OR REPLACE FUNCTION public._pension_bracket_row(p_year integer, p_base numeric)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v numeric;
BEGIN
  IF p_base IS NULL OR p_base <= 0 THEN RETURN 0; END IF;
  SELECT b.monthly_wage INTO v FROM public.labor_pension_brackets b
   WHERE b.year = p_year AND b.monthly_wage >= p_base ORDER BY b.monthly_wage LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;
  SELECT b.monthly_wage INTO v FROM public.labor_pension_brackets b
   WHERE b.year = p_year ORDER BY b.monthly_wage DESC LIMIT 1;
  RETURN COALESCE(v, LEAST(p_base, 150000));
END $function$;
GRANT EXECUTE ON FUNCTION public._pension_bracket_row(integer, numeric) TO anon, authenticated;
