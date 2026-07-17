-- 補齊員工資料 v2 — 完整欄位映射(欄名不同的也對上了) — 2026-07-17
-- 承 20260717160000,補上當時漏掉的:身份族群ethnic_group/兵役military_status/婚姻marital_status/
--   職務類別job_category/編制staffing_status/戶籍registered_address/個人email personal_email/試滿日 等。
-- 員工類型跳過(Excel「一般員工」≠DB 正職/兼職)。學歷/經歷/技能 DB 無欄位不補。
-- 只填空、姓名對(114人無同名)、帶id。idempotent。
-- 補: marital_status 2 / ethnic_group 20 / military_status 9 / job_category 20 / staffing_status 22 / personal_email 0 / registered_address 2 / probation_end_date 22 / id_number 0 / birth_date 0 / gender 0 / address 0 / email 0 / emergency_contact_name 0 / emergency_contact_phone 0 / join_date 0 / position 0 / phone 0

UPDATE public.employees SET ethnic_group = '一般', job_category = '門市人員', staffing_status = '編制內員工', registered_address = '105 台北市松山區南京東路5段47號3樓之5', probation_end_date = '2025-06-16' WHERE name = '許亦翎' AND id = 397;
UPDATE public.employees SET ethnic_group = '一般', job_category = '門市人員', staffing_status = '編制內員工', registered_address = '369 苗栗縣卓蘭鎮坪林里3鄰37之1號', probation_end_date = '2025-12-01' WHERE name = '徐宥芯' AND id = 398;
UPDATE public.employees SET ethnic_group = '一般', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-05-25' WHERE name = '吳昕芛' AND id = 406;
UPDATE public.employees SET ethnic_group = '一般', job_category = '行政人員', staffing_status = '編制內員工', probation_end_date = '2026-06-10' WHERE name = '侯承寯' AND id = 415;
UPDATE public.employees SET job_category = '行政人員', staffing_status = '編制內員工', probation_end_date = '2026-06-16' WHERE name = '蔡沛潔' AND id = 419;
UPDATE public.employees SET ethnic_group = '一般', military_status = '免役', job_category = '行政人員', staffing_status = '編制內員工', probation_end_date = '2026-06-22' WHERE name = '洪伯嘉' AND id = 10;
UPDATE public.employees SET ethnic_group = '一般', military_status = '免役', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-05-25' WHERE name = '游承軒' AND id = 405;
UPDATE public.employees SET ethnic_group = '一般', military_status = '免役', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-05-25' WHERE name = '劉俊廷' AND id = 409;
UPDATE public.employees SET ethnic_group = '一般', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-06-01' WHERE name = '鄭力瑄' AND id = 404;
UPDATE public.employees SET ethnic_group = '一般', military_status = '免役', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-06-09' WHERE name = '許承雋' AND id = 417;
UPDATE public.employees SET ethnic_group = '一般', military_status = '免役', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-06-10' WHERE name = '黃傑查絡' AND id = 418;
UPDATE public.employees SET ethnic_group = '一般', military_status = '免役', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-06-23' WHERE name = '洪友銘' AND id = 431;
UPDATE public.employees SET ethnic_group = '一般', military_status = '免役', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-05-13' WHERE name = '廖俊凱' AND id = 408;
UPDATE public.employees SET ethnic_group = '一般', staffing_status = '編制內員工', probation_end_date = '2026-06-01' WHERE name = '陳苡慧' AND id = 402;
UPDATE public.employees SET ethnic_group = '一般', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-02-23' WHERE name = '蔡伊真' AND id = 399;
UPDATE public.employees SET ethnic_group = '一般', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-03-31' WHERE name = '林思妤' AND id = 400;
UPDATE public.employees SET ethnic_group = '一般', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-04-07' WHERE name = '陳姿螢' AND id = 401;
UPDATE public.employees SET marital_status = '未婚' WHERE name = '黃慈微' AND id = 215;
UPDATE public.employees SET ethnic_group = '一般', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-05-25' WHERE name = '陳柔逸' AND id = 407;
UPDATE public.employees SET ethnic_group = '一般', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-06-01' WHERE name = '賴德旻' AND id = 403;
UPDATE public.employees SET ethnic_group = '一般', military_status = '免役', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-06-03' WHERE name = '陳毅宇' AND id = 416;
UPDATE public.employees SET staffing_status = '編制內員工', probation_end_date = '2026-06-15' WHERE name = '吳旻軒' AND id = 420;
UPDATE public.employees SET marital_status = '未婚', ethnic_group = '一般', military_status = '役畢', job_category = '門市人員', staffing_status = '編制內員工', probation_end_date = '2026-07-09' WHERE name = '郭中亨' AND id = 430;
