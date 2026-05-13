-- 員工改名：韓虎 → 韓德森
-- TEXT denorm（leave_requests.employee 等）有 trigger 同步，不需手動回填
-- 2026-05-13

BEGIN;

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM employees WHERE name = '韓虎';
  IF v_count = 0 THEN
    RAISE NOTICE '查無 員工=韓虎，跳過';
  ELSIF v_count > 1 THEN
    RAISE EXCEPTION '多筆同名 韓虎 (% 筆)，需手動指定 id 後再執行', v_count;
  ELSE
    UPDATE employees SET name = '韓德森' WHERE name = '韓虎';
    RAISE NOTICE '已改名：韓虎 → 韓德森';
  END IF;
END $$;

COMMIT;
