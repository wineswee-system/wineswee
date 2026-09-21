-- ════════════════════════════════════════════════════════════════════════════
-- 修正：國定假日加班費 FT（月薪）算法 — 對齊前端、符合 §39
--
-- 背景：前端 payrollCalc.js 與 DB generate_payroll 兩套算法對國定假日 FT 不一致：
--   前端 = ×1 全程；DB = 1.34/1.67 全程。經確認「以前端為準」（§39「加倍發給」=
--   月薪制當日工資已含 → 8h 內加發 1 倍 = ×1），並補上前端漏掉的「>8h 依 §24 延長」。
--
-- 正確（FT 月薪）：國定假日 ≤8h ×1；>8h 前2h ×1.34、再 ×1.67。
--   （DB 原本全程 1.34/1.67 → 8h 內溢付，本檔修正成 ≤8h ×1。）
-- PT（時薪）維持 ×2 全程，不變。
--
-- 只改 _compute_ot_pay 的 holiday FT 分支，其餘分支（weekday/restday/weekly_off）
-- 原樣保留。generate_payroll 與 comp_time 兌現都呼叫此函式，自動套用修正。
--
-- ⚠️ 例假（weekly_off）FT 目前 ×2，前端是 ×1+補休 —— 牽涉補休 trigger，待確認後另案處理，本檔不動。
-- ⚠️ 生效時機：下次跑 generate_payroll 月結；不追溯已發月份。
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

  -- 國定假日：FT ≤8h ×1（月薪已含當日工資）、>8h 依 §24 延長（前2h ×1.34、再 ×1.67）/ PT ×2 全程
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

  -- 例假：FT/PT 都 ×2 全程（⚠️ 待確認是否改 ×1+補休，本檔保留原樣）
  IF p_category = 'weekly_off' THEN
    RETURN CEIL(p_hours * p_hourly_rate * 2.0);
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
