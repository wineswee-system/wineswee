-- 匯入員工家庭成員(從老闆匯出 col35 成員) — 2026-07-17
-- 拆「姓名，性別，關係」;關係按性別對映(子女+女→女、父母+男→父…)。
-- 去重:該員工已有 family_members 就跳過(WHERE NOT EXISTS)。idempotent。
-- 匯入 10 位員工 / 15 位家庭成員。

INSERT INTO public.family_members (employee_id, name, relationship, gender, organization_id)
SELECT * FROM (VALUES
  (48, '韓米瀾', '女', '女', 1),
  (48, '韓謹', '女', '女', 1)
) AS v(employee_id, name, relationship, gender, organization_id)
WHERE NOT EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.employee_id = 48);

INSERT INTO public.family_members (employee_id, name, relationship, gender, organization_id)
SELECT * FROM (VALUES
  (59, '古佩玄', '母', '女', 1)
) AS v(employee_id, name, relationship, gender, organization_id)
WHERE NOT EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.employee_id = 59);

INSERT INTO public.family_members (employee_id, name, relationship, gender, organization_id)
SELECT * FROM (VALUES
  (65, '張佳馨', '女', '女', 1)
) AS v(employee_id, name, relationship, gender, organization_id)
WHERE NOT EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.employee_id = 65);

INSERT INTO public.family_members (employee_id, name, relationship, gender, organization_id)
SELECT * FROM (VALUES
  (145, '盧慶隨', '母', '女', 1)
) AS v(employee_id, name, relationship, gender, organization_id)
WHERE NOT EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.employee_id = 145);

INSERT INTO public.family_members (employee_id, name, relationship, gender, organization_id)
SELECT * FROM (VALUES
  (122, '吳宜真', '配偶', '女', 1)
) AS v(employee_id, name, relationship, gender, organization_id)
WHERE NOT EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.employee_id = 122);

INSERT INTO public.family_members (employee_id, name, relationship, gender, organization_id)
SELECT * FROM (VALUES
  (210, '羅祐安', '子', '男', 1),
  (210, '羅予晴', '女', '女', 1)
) AS v(employee_id, name, relationship, gender, organization_id)
WHERE NOT EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.employee_id = 210);

INSERT INTO public.family_members (employee_id, name, relationship, gender, organization_id)
SELECT * FROM (VALUES
  (83, '陳玉', '母', '女', 1)
) AS v(employee_id, name, relationship, gender, organization_id)
WHERE NOT EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.employee_id = 83);

INSERT INTO public.family_members (employee_id, name, relationship, gender, organization_id)
SELECT * FROM (VALUES
  (69, '楊子賢', '子', '男', 1)
) AS v(employee_id, name, relationship, gender, organization_id)
WHERE NOT EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.employee_id = 69);

INSERT INTO public.family_members (employee_id, name, relationship, gender, organization_id)
SELECT * FROM (VALUES
  (61, '邱帷恩', '子', '男', 1),
  (61, '周金鳳', '母', '女', 1),
  (61, '游進福', '父', '男', 1),
  (61, '邱品慈', '女', '女', 1)
) AS v(employee_id, name, relationship, gender, organization_id)
WHERE NOT EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.employee_id = 61);

INSERT INTO public.family_members (employee_id, name, relationship, gender, organization_id)
SELECT * FROM (VALUES
  (151, '官芫德', '子', '男', 1)
) AS v(employee_id, name, relationship, gender, organization_id)
WHERE NOT EXISTS (SELECT 1 FROM public.family_members fm WHERE fm.employee_id = 151);
