-- 陳嘉益 baseForInsure 推算（單段，直接 Run）
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
