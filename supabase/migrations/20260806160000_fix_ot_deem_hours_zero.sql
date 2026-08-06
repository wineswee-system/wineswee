-- 修 _ot_deem_hours(0):沒上班不擬制 → 修休息日加班逐筆明細顯示 NT$0 — 2026-08-06
-- ════════════════════════════════════════════════════════════════════════════
-- 症狀:休息日加班(尤其 is_exception=true 的整段)在「加班逐筆明細」顯示 NT$0,
--   但錢有進 gross(靠 otPayRestday 聚合欄)。陳嘉益 2026-07-29 restday 3h → 右欄 NT$0。
-- 根因:_ot_pay_zh 休息日用「擬制時數 _ot_deem_hours」。逐筆 exception row 的
--   _pay = _ot_pay_zh(reg+ext) − _ot_pay_zh(reg)。當 reg=0(整段 is_exception)時:
--     _ot_deem_hours(0)=4、_ot_deem_hours(3)=4(都≤4擬制成4)
--     → _ot_pay_zh(3) 與 _ot_pay_zh(0) 一模一樣 → 相減 = 0。
--   問題就是「0 小時也擬制成 4h」——沒上班不該擬制。
-- 修法:_ot_deem_hours 最前面加「p_hours<=0 → 0」。正數工時(≤4→4)不變。
-- ★ 不動 gross:v_ot_pay_rd + v_otx_pay_rd = SUM(_ot_pay_zh(reg)+(_ot_pay_zh(reg+ext)
--   −_ot_pay_zh(reg))) = SUM(_ot_pay_zh(reg+ext)),_ot_pay_zh(reg) 在 legal/exception
--   相加時對消 → 改 _ot_pay_zh(0) 不影響加班總額,只把錢在 legal↔exception 間挪、
--   讓逐筆 exception row 顯示正確金額。_ot_deem_hours 僅 _ot_pay_zh 使用(已查證)。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._ot_deem_hours(p_hours numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_hours <= 0 THEN 0          -- ★ 沒上班不擬制(原本漏這句 → 逐筆 exception row 相減=0)
    WHEN p_hours <= 4 THEN 4
    WHEN p_hours < 8  THEN 8
    ELSE least(p_hours, 12)
  END
$function$;
