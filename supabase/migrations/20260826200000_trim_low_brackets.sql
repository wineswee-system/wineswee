-- 刪除用不到的超低級距(11,100 以下=部分工時下限之下),讓下拉/管理頁從 11,100 起;三表通用、不影響查表(floor 皆 >= 11,100)
DELETE FROM public.labor_ins_brackets    WHERE insured_salary < 11100;
DELETE FROM public.health_ins_brackets   WHERE insured_salary < 11100;
DELETE FROM public.labor_pension_brackets WHERE monthly_wage   < 11100;
