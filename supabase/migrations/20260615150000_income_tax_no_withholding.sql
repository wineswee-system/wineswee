-- ════════════════════════════════════════════════════════════════════════════
-- 修正：所得稅不代扣（公司政策）— DB 現行在扣 = 多扣員工的稅
--
-- 背景：公司政策是「薪資所得稅不代扣，員工自行年度申報」。前端 payrollCalc 已經
--   不扣（withholdTax:false → 永遠 0）。但 DB generate_payroll 一律
--   `v_income_tax := _calc_monthly_withholding(v_gross)` 並扣進 net → 實際月結
--   多扣了超過免稅門檻 / 大額 OT 員工的所得稅。這是現行錯誤，不只是試算不一致。
--
-- 修法（最小手術）：_calc_monthly_withholding 是被所有 generate_payroll 版本 +
--   年終獎金共用的小子函式。改它一律回 0 → 所有呼叫端都不再代扣，**不必碰 500 行
--   的 generate_payroll 大函式**（避開 drift + 重 paste 風險）。
--
-- 原 5 段級距公式保留在 git 歷史（20260427000000）；若日後改政策要代扣，恢復即可。
-- ⚠️ 生效：下次 generate_payroll 月結 / 年終；不追溯已發月份。員工 net 會變高（拿回不該扣的）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._calc_monthly_withholding(p_gross NUMERIC)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
  -- 公司政策：所得稅不代扣（員工自行申報）→ 代扣稅額一律 0
  SELECT 0::numeric
$$;

GRANT EXECUTE ON FUNCTION public._calc_monthly_withholding(NUMERIC) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
