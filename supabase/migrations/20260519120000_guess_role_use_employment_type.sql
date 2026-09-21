-- ════════════════════════════════════════════════════════════════════════════
-- _guess_employee_bonus_role 改用 employees.employment_type 判定（更準）
-- ────────────────────────────────────────────────────────────────────────────
-- 問題：之前用 employees.position 字串猜（含「兼職」就判兼職），但 position
-- 是「顯示用字串」常被當標籤寫成「兼職人員」即使該員工實際 employment_type
-- 是「全職」。導致中山國小張丞佑 (employment_type=全職、position=兼職人員)
-- 被誤判為兼職。
--
-- 修法：1:1 重寫 _guess_employee_bonus_role，判定優先序：
--   1. 是該店店長 (stores.manager_id = emp.id) → 店長
--   2. employment_type IN ('兼職', 'PT', '工讀', '實習') → 兼職
--   3. 其他 → 正職
--
-- 既有開過單的 row 不會自動改（snapshot 是 INSERT 時記的），admin 在前端
-- 角色下拉手動改即可；或砍掉重開單會用新邏輯重判。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._guess_employee_bonus_role(p_emp_id INT, p_store_id INT)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_emp_type   TEXT;
  v_is_manager BOOLEAN;
BEGIN
  SELECT employment_type INTO v_emp_type FROM employees WHERE id = p_emp_id;
  SELECT (manager_id = p_emp_id) INTO v_is_manager FROM stores WHERE id = p_store_id;

  IF v_is_manager IS TRUE THEN RETURN '店長'; END IF;
  IF v_emp_type IN ('兼職', 'PT', '工讀', '實習', 'part_time') THEN RETURN '兼職'; END IF;
  RETURN '正職';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
