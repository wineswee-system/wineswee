-- ════════════════════════════════════════════════════════════════════
-- 批次設定員工分類 employment_category — 2026-06-11
-- ════════════════════════════════════════════════════════════════════

-- ═══ 1. 行政 (admin) ═══
UPDATE public.salary_structures ss
SET employment_category = 'admin'
FROM public.employees e
WHERE ss.employee_id = e.id
  AND e.name IN (
    '林巧玉', '楊家謙', '張庭瑋', '韓德森', '徐其祥', '尤致皓',
    '陳佩璇', '陳楷仁', '張啟達', '林襄', '黃蘊珊', '李英顥',
    '羅紹輝', '詹健如', '劉雅玲', '陳虹', '張開翔', '洪伯嘉'
  );

-- 沒有 salary_structures 的行政員工補建一筆
INSERT INTO public.salary_structures (employee_id, organization_id, employment_category, salary_type, base_salary)
SELECT e.id, e.organization_id, 'admin', 'monthly', COALESCE(e.base_salary, 0)
FROM public.employees e
WHERE e.name IN (
    '林巧玉', '楊家謙', '張庭瑋', '韓德森', '徐其祥', '尤致皓',
    '陳佩璇', '陳楷仁', '張啟達', '林襄', '黃蘊珊', '李英顥',
    '羅紹輝', '詹健如', '劉雅玲', '陳虹', '張開翔', '洪伯嘉'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.salary_structures ss WHERE ss.employee_id = e.id
  );

-- ═══ 2. 計件 (piece) ═══
UPDATE public.salary_structures ss
SET employment_category = 'piece'
FROM public.employees e
WHERE ss.employee_id = e.id
  AND e.name IN ('朱紹善', '廖俊凱');

-- 沒有 salary_structures 的計件員工補建一筆
INSERT INTO public.salary_structures (employee_id, organization_id, employment_category, salary_type, base_salary)
SELECT e.id, e.organization_id, 'piece', 'monthly', 0
FROM public.employees e
WHERE e.name IN ('朱紹善', '廖俊凱')
  AND NOT EXISTS (
    SELECT 1 FROM public.salary_structures ss WHERE ss.employee_id = e.id
  );

-- ═══ 驗證 ═══
SELECT e.name, ss.employment_category
FROM public.salary_structures ss
JOIN public.employees e ON e.id = ss.employee_id
WHERE ss.employment_category IN ('admin', 'piece')
ORDER BY ss.employment_category, e.name;
