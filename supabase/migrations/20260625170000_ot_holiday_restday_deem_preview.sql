-- ════════════════════════════════════════════════════════════════════════════
-- 加班費規則：休息日「時數換算(deem)」+ 國定假日「有上班固定 8h」(階段1：preview)
-- 2026-06-25
--
-- 只改 preview 走的小函式 _ot_pay_zh（入帳 generate_payroll 走另一支 _compute_ot_pay，本檔不碰）。
-- 前端 payrollCalc.js 同步改（diff harness 綁兩邊一致）。
--
-- 規則（正職 FT）：
--   平日   ：不變。前2h×1.34、後×1.67
--   休息日 ：先 deem 時數（≤2→2、2<h<8→8、≥8→實際,上限12）→ 套階梯 前2×1.34/3~8×1.67/9~12×2.67
--   國定   ：當天有上班(>0) → 固定 8h×時薪×1（多給一天）；超過8h的部分 §24延長(前2h×1.34、後×1.67)
-- 兼職（PT, is_hourly）：休息日/國定 ×2 全程照實際（不 deem）
--
-- 驗證錨點：#848 休息日實際2.5h → deem 8h → 階梯 = 時薪283.33 → 約 3,599（與畫面一致）
-- 冪等：deem(2)=2 / deem(8)=8 / deem(≥8)=實際 → 對已是 2/8 的舊資料重算不變。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 休息日時數換算（deem）：≤2→2、2<h<8→8、≥8→實際(上限12) ──
CREATE OR REPLACE FUNCTION public._ot_deem_hours(p_hours numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_hours <= 2 THEN 2
    WHEN p_hours < 8  THEN 8
    ELSE least(p_hours, 12)
  END
$$;
GRANT EXECUTE ON FUNCTION public._ot_deem_hours(numeric) TO authenticated, anon, service_role;

-- ── 單日單類別加班費（preview 用）──
-- restday：FT 先 deem 再套階梯；PT ×2 全程
-- holiday：FT 有上班固定 8h×1 + 超過8h §24延長；PT ×2 全程
CREATE OR REPLACE FUNCTION public._ot_pay_zh(
  p_hours     numeric,
  p_hourly    numeric,
  p_category  text,
  p_is_hourly boolean
) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_category
    WHEN 'weekday' THEN
      CASE WHEN p_hours <= 2 THEN ceil(p_hours * p_hourly * 1.34)
           ELSE ceil(2 * p_hourly * 1.34 + (p_hours - 2) * p_hourly * 1.67) END
    WHEN 'restday' THEN
      CASE WHEN p_is_hourly THEN ceil(p_hours * p_hourly * 2)
           ELSE ceil(least(public._ot_deem_hours(p_hours), 2) * p_hourly * 1.34
                   + least(greatest(public._ot_deem_hours(p_hours) - 2, 0), 6) * p_hourly * 1.67
                   + greatest(public._ot_deem_hours(p_hours) - 8, 0) * p_hourly * 2.67) END
    WHEN 'holiday' THEN
      CASE WHEN p_is_hourly THEN ceil(p_hours * p_hourly * 2)
           WHEN p_hours <= 0 THEN 0
           ELSE ceil(8 * p_hourly
                   + least(greatest(p_hours - 8, 0), 2) * p_hourly * 1.34
                   + greatest(p_hours - 10, 0) * p_hourly * 1.67) END
    WHEN 'weekly_off' THEN
      CASE WHEN p_is_hourly THEN ceil(p_hours * p_hourly * 2)
           ELSE ceil(p_hours * p_hourly) END
    ELSE 0 END
$$;

GRANT EXECUTE ON FUNCTION public._ot_pay_zh(numeric, numeric, text, boolean)
  TO authenticated, anon, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
