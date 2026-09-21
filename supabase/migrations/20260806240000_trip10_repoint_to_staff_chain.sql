-- 出差 #10(張庭瑋)改走行政人員鏈:張庭瑋已非部門主管,補回「部門主管」關 — 2026-08-06
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:張庭瑋(62)原為營運部經理,現已卸任(周容甄425 接任,他不再是任何部門 manager)。
--   出差 #10 送出當下(08-05)仍被歸「主管」→ 套 chain 31「主管簽核鏈」(執行長→人資,
--   跳過部門主管)。但他現與黃蘊珊(148)同階(dept23/store20/role3),黃所有單都走
--   chain 32「行政人員簽核鏈」(部門主管→執行長→人資)。#10 應比照。
-- 修:#10 approval_chain_id 31→32,手動重灌快照(trg 只 AFTER INSERT 不管 UPDATE),
--   凍結現行解析:step0 部門主管=周容甄(425)、step1 執行長=陳虹(52)、step2 人資=張啟達(152)。
--   #10 目前 current_step=0(執行長那關陳虹尚未簽)→切鏈後 step0 變周容甄先批,乾淨不打斷。
--   他未來的單會自動歸 chain 32(已非 manager),僅此在飛單需手修。
-- 守門:僅當 #10 仍 chain31/待審核 才動 → 冪等(已切→跳過)。不改 function/trigger。
-- ════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.business_trips
              WHERE id = 10 AND approval_chain_id = 31 AND status = '待審核') THEN
    -- 1. 清舊鏈快照(_snapshot_chain_for_request 是 ON CONFLICT DO NOTHING,需先刪才會重建)
    DELETE FROM public.request_chain_snapshots WHERE request_type = 'trip' AND request_id = 10;
    -- 2. 換鏈 + 關卡歸 0(部門主管先批)
    UPDATE public.business_trips SET approval_chain_id = 32, current_step = 0 WHERE id = 10;
    -- 3. 依 chain 32 重灌快照,凍結現行簽核人(帶申請人 62 → 周容甄/陳虹/張啟達)
    PERFORM public._snapshot_chain_for_request('trip', 10, 32, 62);
  END IF;
END $$;
