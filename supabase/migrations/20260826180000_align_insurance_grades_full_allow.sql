-- 投保基數改「本薪+全部津貼(含主管/職務加給)」重算勞保/職災/健保/勞退
UPDATE public.employees SET labor_occ_injury_grade=53000,health_ins_grade=53000,labor_pension_grade=53000 WHERE id=68;
UPDATE public.employees SET labor_occ_injury_grade=55400,health_ins_grade=55400,labor_pension_grade=55400 WHERE id=113;
UPDATE public.employees SET labor_occ_injury_grade=55400,health_ins_grade=55400,labor_pension_grade=55400 WHERE id=75;
UPDATE public.employees SET labor_occ_injury_grade=55400,health_ins_grade=55400,labor_pension_grade=55400 WHERE id=134;
UPDATE public.employees SET labor_occ_injury_grade=63800,health_ins_grade=63800,labor_pension_grade=63800 WHERE id=141;
UPDATE public.employees SET labor_occ_injury_grade=53000,health_ins_grade=53000,labor_pension_grade=53000 WHERE id=94;
UPDATE public.employees SET labor_occ_injury_grade=55400,health_ins_grade=55400,labor_pension_grade=55400 WHERE id=107;
UPDATE public.employees SET labor_occ_injury_grade=57800,health_ins_grade=57800,labor_pension_grade=57800 WHERE id=71;
