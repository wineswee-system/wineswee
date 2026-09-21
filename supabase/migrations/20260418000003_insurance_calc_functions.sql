-- ═══════════════════════════════════════════════════════════
-- 勞保 / 健保 保費計算函式 + 2026 年級距資料
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────
-- 1. calculate_labor_insurance
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_labor_insurance(
  p_salary    NUMERIC,
  p_year      INT DEFAULT 2026
)
RETURNS TABLE (
  insured_salary   NUMERIC,
  employee_premium NUMERIC,
  employer_premium NUMERIC
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
    SELECT
      b.insured_salary,
      b.employee_premium,
      b.employer_premium
    FROM public.labor_ins_brackets b
    WHERE b.year = p_year
      AND b.min_salary <= p_salary
    ORDER BY b.grade DESC
    LIMIT 1;

  -- 若找不到任何級距（薪資低於最低級距），回傳最低級
  IF NOT FOUND THEN
    RETURN QUERY
      SELECT
        b.insured_salary,
        b.employee_premium,
        b.employer_premium
      FROM public.labor_ins_brackets b
      WHERE b.year = p_year
      ORDER BY b.grade ASC
      LIMIT 1;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.calculate_labor_insurance IS '依月薪查詢勞保投保級距，回傳投保薪資、勞工自付、雇主負擔';

-- ───────────────────────────────────────────────────────────
-- 2. calculate_health_insurance
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_health_insurance(
  p_salary      NUMERIC,
  p_year        INT DEFAULT 2026,
  p_dependents  INT DEFAULT 0
)
RETURNS TABLE (
  insured_salary   NUMERIC,
  employee_premium NUMERIC,
  employer_premium NUMERIC
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_insured   NUMERIC;
  v_emp_base  NUMERIC;
  v_employer  NUMERIC;
BEGIN
  -- 找到對應級距
  SELECT b.insured_salary, b.employee_premium, b.employer_premium
    INTO v_insured, v_emp_base, v_employer
    FROM public.health_ins_brackets b
   WHERE b.year = p_year
     AND b.min_salary <= p_salary
   ORDER BY b.grade DESC
   LIMIT 1;

  -- 若找不到，取最低級
  IF v_insured IS NULL THEN
    SELECT b.insured_salary, b.employee_premium, b.employer_premium
      INTO v_insured, v_emp_base, v_employer
      FROM public.health_ins_brackets b
     WHERE b.year = p_year
     ORDER BY b.grade ASC
     LIMIT 1;
  END IF;

  -- 眷屬共用被保險人級距：員工自付 = 基本保費 * (1 + 眷屬人數)
  insured_salary   := v_insured;
  employee_premium := v_emp_base * (1 + p_dependents);
  employer_premium := v_employer;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.calculate_health_insurance IS '依月薪查詢健保投保級距，眷屬共用員工級距，回傳投保薪資、員工自付(含眷屬)、雇主負擔';

-- ───────────────────────────────────────────────────────────
-- 3. Seed: 2026 勞保級距 (勞工保險普通事故 12%, 就業保險 1%)
--    費率: 普通事故 12% → 勞工 20% 雇主 70%
--          就業保險  1% → 勞工 20% 雇主 70%
--    合計費率 13%, 勞工負擔 20% = 2.6%, 雇主負擔 70% = 9.1%
-- ───────────────────────────────────────────────────────────
INSERT INTO public.labor_ins_brackets (year, grade, min_salary, insured_salary, employee_premium, employer_premium)
VALUES
  -- 2026 台灣勞保投保薪資分級表 (含就業保險)
  (2026,  1,     0, 27470,  714, 2500),
  (2026,  2, 27471, 28800,  749, 2621),
  (2026,  3, 28801, 30300,  788, 2757),
  (2026,  4, 30301, 31800,  827, 2894),
  (2026,  5, 31801, 33300,  866, 3030),
  (2026,  6, 33301, 34800,  905, 3167),
  (2026,  7, 34801, 36300,  944, 3303),
  (2026,  8, 36301, 38200,  993, 3476),
  (2026,  9, 38201, 40100, 1043, 3649),
  (2026, 10, 40101, 42000, 1092, 3822),
  (2026, 11, 42001, 43900, 1141, 3995),
  (2026, 12, 43901, 45800, 1191, 4168),
  (2026, 13, 45801, 48200, 1253, 4386),
  (2026, 14, 48201, 50600, 1316, 4604),
  (2026, 15, 50601, 53000, 1378, 4823)
ON CONFLICT (year, grade) DO NOTHING;

-- ───────────────────────────────────────────────────────────
-- 4. Seed: 2026 健保級距
--    費率: 5.17%, 勞工負擔 30%, 雇主負擔 60%
--    員工自付 = 投保薪資 * 5.17% * 30% (單人，不含眷屬)
--    雇主負擔 = 投保薪資 * 5.17% * 60% * (1 + 0.58 平均眷口)
-- ───────────────────────────────────────────────────────────
INSERT INTO public.health_ins_brackets (year, grade, min_salary, insured_salary, employee_premium, employer_premium)
VALUES
  (2026,  1,     0, 27470,  426, 1349),
  (2026,  2, 27471, 28800,  447, 1414),
  (2026,  3, 28801, 30300,  470, 1488),
  (2026,  4, 30301, 31800,  493, 1562),
  (2026,  5, 31801, 33300,  517, 1636),
  (2026,  6, 33301, 34800,  540, 1710),
  (2026,  7, 34801, 36300,  563, 1783),
  (2026,  8, 36301, 38200,  593, 1877),
  (2026,  9, 38201, 40100,  622, 1970),
  (2026, 10, 40101, 42000,  652, 2063),
  (2026, 11, 42001, 43900,  681, 2156),
  (2026, 12, 43901, 45800,  711, 2250),
  (2026, 13, 45801, 48200,  748, 2368),
  (2026, 14, 48201, 50600,  785, 2486),
  (2026, 15, 50601, 53000,  822, 2604)
ON CONFLICT (year, grade) DO NOTHING;

COMMIT;
