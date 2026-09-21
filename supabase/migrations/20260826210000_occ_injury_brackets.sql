-- 職災(勞工職業災害保險)投保薪資分級表:獨立表,可在管理頁維護。級距同勞保、上限 72,800。
CREATE TABLE IF NOT EXISTS public.labor_occ_injury_brackets (
  year         integer NOT NULL,
  grade        integer NOT NULL,
  min_salary   numeric NOT NULL,
  insured_salary numeric NOT NULL,
  PRIMARY KEY (year, grade)
);

-- 2026 灌入:取勞保表 11,100~72,800 的級距,重新編號 1..N
DELETE FROM public.labor_occ_injury_brackets WHERE year = 2026;
INSERT INTO public.labor_occ_injury_brackets (year, grade, min_salary, insured_salary)
SELECT 2026, ROW_NUMBER() OVER (ORDER BY insured_salary), min_salary, insured_salary
FROM public.labor_ins_brackets
WHERE year = 2026 AND insured_salary <= 72800;

ALTER TABLE public.labor_occ_injury_brackets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS labor_occ_injury_brackets_read ON public.labor_occ_injury_brackets;
CREATE POLICY labor_occ_injury_brackets_read ON public.labor_occ_injury_brackets FOR SELECT USING (true);
DROP POLICY IF EXISTS labor_occ_injury_brackets_admin_write ON public.labor_occ_injury_brackets;
CREATE POLICY labor_occ_injury_brackets_admin_write ON public.labor_occ_injury_brackets
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
