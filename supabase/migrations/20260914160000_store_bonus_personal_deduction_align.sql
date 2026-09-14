-- 營運獎金辦法 Phase2c:個人扣對齊(忘卡第4次起100、曠職1000);病假/事假/客訴逾期用自訂扣項欄位
ALTER TABLE public.store_bonus_role_config ALTER COLUMN punch_deduct_start SET DEFAULT 4;
ALTER TABLE public.store_bonus_role_config ALTER COLUMN punch_deduct_amount SET DEFAULT 100;
UPDATE public.store_bonus_role_config SET punch_deduct_start=4, punch_deduct_amount=100;
UPDATE public.store_bonus_role_config SET absence_deduct=1000;
