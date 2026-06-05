-- ════════════════════════════════════════════════════════════════════════════
-- 修陳嘉益 salary_structures 主管/職務津貼雙重算
--
-- 問題：supervisor_allowance=8000 AND role_allowance=8000 兩欄都填
--      Salary.jsx 邏輯 roleAllowance = supervisor + role = 16000 → baseForInsure 多算 8000
--      → 時薪 hr 從正確的 260 變成錯誤的 294
--      → 加班費全部高估
--
-- 來源：2026-06-04 import migration 把 8000 塞 role_allowance（舊欄）。
--      之後有人手動到 /hr/salary-structures 又把 supervisor_allowance 填 8000，
--      沒清掉舊的 role_allowance。
--
-- 修法：保留 supervisor_allowance=8000（新欄位），role_allowance 歸 0
-- 安全：只動陳嘉益 (employee_id=141)，加多重 WHERE 防誤觸；idempotent
--
-- audit 已確認全公司只有他 1 個壞。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.salary_structures
     SET role_allowance = 0
   WHERE employee_id = 141
     AND supervisor_allowance = 8000
     AND role_allowance = 8000;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '陳嘉益 role_allowance 清 0：% 筆 row 被更新', v_count;

  IF v_count = 0 THEN
    RAISE NOTICE '※ 0 筆 = 該資料已修過 / 員工 ID 或數字對不上，無動作（migration 是 idempotent）';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
