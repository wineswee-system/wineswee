-- ════════════════════════════════════════════════════════════════════════════
-- 休息日加班 deem 門檻修正：第一段 2 → 4（做1給4）
-- 2026-06-25
--
-- 休息日時數換算改為：≤4→4、4<h<8→8、≥8→實際(上限12，9~12h 走 ×2.67 階梯)。
-- 只動第一段門檻（原本 ≤2→2），其餘不變。冪等。
-- 驗證：林巧玉 4/18 休息日 4h → ≤4→4 → 階梯 1,706（與原畫面一致）。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._ot_deem_hours(p_hours numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_hours <= 4 THEN 4
    WHEN p_hours < 8  THEN 8
    ELSE least(p_hours, 12)
  END
$$;
GRANT EXECUTE ON FUNCTION public._ot_deem_hours(numeric) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
