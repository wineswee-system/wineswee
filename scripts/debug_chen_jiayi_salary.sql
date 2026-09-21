-- ════════════════════════════════════════════════════════════════════════════
-- 診斷：陳嘉益 (L2021080) 為何時薪算出 294 而非預期 260
--   預期 baseForInsure = 41000+8000+3000+7500+3000 = 62,500 → hr=260
--   實際 hr=294 → baseForInsure=70,560 → 多 8,060
--
-- ★ 用法：SQL Editor 一次只顯示最後一段結果，請「圈選一段、Run、看結果」逐段跑
-- ════════════════════════════════════════════════════════════════════════════


-- ─── 段 1：員工基本資料 ─── (圈這段 Run)
SELECT id, name, employee_number, store, dept, position, base_salary, join_date, resign_date
  FROM employees
 WHERE name = '陳嘉益' OR employee_number = 'L2021080';


-- ─── 段 2：所有 salary_structures rows（看是不是多筆 effective_from）─── (圈這段 Run)
SELECT id, employee_id, effective_from, salary_type, hourly_rate,
       base_salary,
       supervisor_allowance, role_allowance,
       meal_allowance, transport_allowance, attendance_bonus,
       night_shift_allowance, cross_store_allowance,
       custom_allowances,
       base_insured,
       health_ins_dependents,
       created_at, updated_at
  FROM salary_structures
 WHERE employee_id IN (SELECT id FROM employees WHERE name='陳嘉益' OR employee_number='L2021080')
 ORDER BY effective_from DESC;


-- ─── 段 3：推算 baseForInsure 跟時薪（最關鍵！）─── (圈這段 Run)
SELECT
  ss.id,
  ss.effective_from,
  ss.base_salary                                    AS "本薪",
  COALESCE(ss.supervisor_allowance, 0)              AS "主管",
  COALESCE(ss.role_allowance, 0)                    AS "職務",
  COALESCE(ss.supervisor_allowance, 0)
    + COALESCE(ss.role_allowance, 0)                AS "主管+職務",
  COALESCE(ss.night_shift_allowance, 0)             AS "夜班",
  COALESCE(ss.cross_store_allowance, 0)             AS "跨店",
  COALESCE(ss.meal_allowance, 0)                    AS "餐",
  COALESCE(ss.transport_allowance, 0)               AS "交",
  COALESCE(ss.attendance_bonus, 0)                  AS "全勤",
  (
    SELECT COALESCE(SUM(
      CASE WHEN (c->>'name') ~ '夜班|夜間|跨店|跨區' THEN 0
           ELSE COALESCE((c->>'amount')::NUMERIC, 0)
      END), 0)
    FROM jsonb_array_elements(COALESCE(ss.custom_allowances, '[]'::jsonb)) c
  )                                                 AS "其他自訂",
  ss.base_salary
    + COALESCE(ss.supervisor_allowance, 0) + COALESCE(ss.role_allowance, 0)
    + COALESCE(ss.night_shift_allowance, 0) + COALESCE(ss.cross_store_allowance, 0)
    + COALESCE(ss.meal_allowance, 0) + COALESCE(ss.transport_allowance, 0)
    + COALESCE(ss.attendance_bonus, 0)
    + (
      SELECT COALESCE(SUM(
        CASE WHEN (c->>'name') ~ '夜班|夜間|跨店|跨區' THEN 0
             ELSE COALESCE((c->>'amount')::NUMERIC, 0)
        END), 0)
      FROM jsonb_array_elements(COALESCE(ss.custom_allowances, '[]'::jsonb)) c
    )                                               AS "baseForInsure",
  ROUND((
    ss.base_salary
      + COALESCE(ss.supervisor_allowance, 0) + COALESCE(ss.role_allowance, 0)
      + COALESCE(ss.night_shift_allowance, 0) + COALESCE(ss.cross_store_allowance, 0)
      + COALESCE(ss.meal_allowance, 0) + COALESCE(ss.transport_allowance, 0)
      + COALESCE(ss.attendance_bonus, 0)
      + (
        SELECT COALESCE(SUM(
          CASE WHEN (c->>'name') ~ '夜班|夜間|跨店|跨區' THEN 0
               ELSE COALESCE((c->>'amount')::NUMERIC, 0)
          END), 0)
        FROM jsonb_array_elements(COALESCE(ss.custom_allowances, '[]'::jsonb)) c
      )
  ) / 30.0 / 8.0)                                    AS "推算時薪"
FROM salary_structures ss
WHERE ss.employee_id IN (SELECT id FROM employees WHERE name='陳嘉益' OR employee_number='L2021080')
ORDER BY ss.effective_from DESC;


-- ─── 段 4：custom_allowances 內容明細 ─── (圈這段 Run，已知結果：夜班 3000、跨店 7500)
SELECT
  ss.id,
  ss.effective_from,
  c->>'name' AS "津貼名",
  (c->>'amount')::NUMERIC AS "金額"
FROM salary_structures ss
LEFT JOIN LATERAL jsonb_array_elements(COALESCE(ss.custom_allowances, '[]'::jsonb)) c ON TRUE
WHERE ss.employee_id IN (SELECT id FROM employees WHERE name='陳嘉益' OR employee_number='L2021080')
  AND c IS NOT NULL
ORDER BY ss.effective_from DESC, c->>'name';
