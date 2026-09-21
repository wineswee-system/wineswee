-- ════════════════════════════════════════════════════════════════════════════
-- 修正：例假（weekly_off）加班費 FT 溢付 — 對齊前端、符合 §40
--
-- 現況（溢付）：例假 FT 出勤同時拿到
--   (1) ×2 現金  ← trg_force_ot_type_for_weekly_off_ft 強制 ot_type='pay'，
--       進 generate_payroll 的 weekly_off 桶，_compute_ot_pay 給 ×2
--   (2) 補休一天 ← trg_create_comp_time_ledger 強制建 comp_time（×1 凍結）
--   = ×2 現金 + 補休 → 多給了一倍現金。
--
-- §40 例假出勤 = 工資「加倍發給」（月薪制當日已含 → 加發 1 倍 = ×1）+ 事後補假。
-- 前端 payrollCalc 本來就是「×1 現金 + 補休」（正確），只有 DB 的 _compute_ot_pay
-- weekly_off 給 ×2 是錯的。
--
-- 修正：_compute_ot_pay 的 weekly_off 改 FT/PT 分流（與 holiday 對稱）：
--   FT（月薪）→ ×1（因另有補休 ledger）；PT（時薪）→ ×2（無補休）。
-- 本檔同時含上一支 20260615130000 的 holiday FT 修正（self-contained，跑這支即完整）。
--
-- ⚠️ 例假 FT 現金加班費會從 ×2 降為 ×1（修正溢付）；補休不變。下次月結生效，不追溯。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._compute_ot_pay(
  p_hours        NUMERIC,
  p_hourly_rate  NUMERIC,
  p_category     TEXT,
  p_salary_type  TEXT DEFAULT 'monthly'
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_is_ft BOOLEAN := (COALESCE(p_salary_type, 'monthly') = 'monthly');
BEGIN
  IF p_hours IS NULL OR p_hours <= 0 OR p_hourly_rate IS NULL OR p_hourly_rate <= 0 THEN
    RETURN 0;
  END IF;

  -- 平日：FT/PT 一樣
  IF p_category = 'weekday' THEN
    RETURN CEIL(
      LEAST(p_hours, 2) * p_hourly_rate * 1.34
      + GREATEST(p_hours - 2, 0) * p_hourly_rate * 1.67
    );
  END IF;

  -- 國定假日：FT ≤8h ×1（月薪已含當日）、>8h §24 延長（前2h ×1.34、再 ×1.67）/ PT ×2 全程
  IF p_category = 'holiday' THEN
    IF v_is_ft THEN
      RETURN CEIL(
        LEAST(p_hours, 8) * p_hourly_rate * 1.0
        + LEAST(GREATEST(p_hours - 8, 0), 2) * p_hourly_rate * 1.34
        + GREATEST(p_hours - 10, 0) * p_hourly_rate * 1.67
      );
    ELSE
      RETURN CEIL(p_hours * p_hourly_rate * 2.0);
    END IF;
  END IF;

  -- 例假：FT ×1（另有補休 ledger，§40 加發 1 倍）/ PT ×2（無補休）
  IF p_category = 'weekly_off' THEN
    IF v_is_ft THEN
      RETURN CEIL(p_hours * p_hourly_rate * 1.0);
    ELSE
      RETURN CEIL(p_hours * p_hourly_rate * 2.0);
    END IF;
  END IF;

  -- 休息日（restday）：FT/PT 都用階梯 1.34/1.67/2.67
  RETURN CEIL(
    LEAST(p_hours, 2) * p_hourly_rate * 1.34
    + LEAST(GREATEST(p_hours - 2, 0), 6) * p_hourly_rate * 1.67
    + GREATEST(p_hours - 8, 0) * p_hourly_rate * 2.67
  );
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
