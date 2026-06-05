-- ════════════════════════════════════════════════════════════════════════════
-- AUDIT：找出 salary_structures 中 supervisor_allowance + role_allowance
--        兩欄都 > 0 的員工（雙重算的人）
--
-- 用法：SQL Editor 圈整段 Run，把結果貼給 Claude。
-- ════════════════════════════════════════════════════════════════════════════

SELECT
  e.id           AS "員工ID",
  e.name         AS "姓名",
  e.employee_number AS "員編",
  e.store        AS "店",
  e.position     AS "職稱",
  ss.effective_from AS "起算日",
  ss.supervisor_allowance AS "主管(雙重)",
  ss.role_allowance       AS "職務(雙重)",
  (ss.supervisor_allowance + ss.role_allowance) AS "被算的總額",
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
    )                                              AS "現在算出的baseForInsure",
  -- 修掉雙重後的 baseForInsure（只保留 supervisor）
  ss.base_salary
    + COALESCE(ss.supervisor_allowance, 0)
    + COALESCE(ss.night_shift_allowance, 0) + COALESCE(ss.cross_store_allowance, 0)
    + COALESCE(ss.meal_allowance, 0) + COALESCE(ss.transport_allowance, 0)
    + COALESCE(ss.attendance_bonus, 0)
    + (
      SELECT COALESCE(SUM(
        CASE WHEN (c->>'name') ~ '夜班|夜間|跨店|跨區' THEN 0
             ELSE COALESCE((c->>'amount')::NUMERIC, 0)
        END), 0)
      FROM jsonb_array_elements(COALESCE(ss.custom_allowances, '[]'::jsonb)) c
    )                                              AS "修後baseForInsure"
FROM salary_structures ss
JOIN employees e ON e.id = ss.employee_id
WHERE COALESCE(ss.supervisor_allowance, 0) > 0
  AND COALESCE(ss.role_allowance, 0) > 0
ORDER BY (ss.supervisor_allowance + ss.role_allowance) DESC;
