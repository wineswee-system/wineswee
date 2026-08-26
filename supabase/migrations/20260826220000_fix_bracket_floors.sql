-- 依確認下限修正:勞保11100 / 職災29500 / 健保29500 / 勞退1500
-- 職災、健保 砍到 29,500 起
DELETE FROM public.labor_occ_injury_brackets WHERE insured_salary < 29500;
DELETE FROM public.health_ins_brackets       WHERE insured_salary < 29500;
-- 勞退 還原 1,500~9,900(先前誤刪);grade 1~7
INSERT INTO public.labor_pension_brackets (year, grade, min_salary, monthly_wage) VALUES
  (2026,1,0,1500),(2026,2,1501,3000),(2026,3,3001,4500),(2026,4,4501,6000),
  (2026,5,6001,7500),(2026,6,7501,8700),(2026,7,8701,9900)
ON CONFLICT (year,grade) DO NOTHING;
-- 勞保 floor 11,100 已符合,不動
