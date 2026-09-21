-- 修復:修正前(7/29 之前)舊機制重送、跳過被駁關的壞狀態單 — 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:20260729120000 之前,expense_requests 被駁後編輯重送,current_step 沒歸0,
--       結果鏈跳過被駁那關繼續往後(下一關能簽,但被駁人根本沒重審)。
-- 掃描找到 2 張(在飛+current_step 已超過 ASH 中被駁的 step):
--   #311 張啟達關0駁回→跳到關1;#396 陳虹關1駁回→跳到關2。
-- 修法:比照新行為,把這 2 張 current_step 歸 0,重推關0 → 照順序重新簽,
--       原駁回關的人會真的再審到。idempotent:current_step 已=0 就不動、不重推。
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.expense_requests
     WHERE id = 396              -- #311 是已軟刪的測試單,排除;只修真實在飛的 #396
       AND status = '申請中'
       AND current_step > 0
       AND deleted_at IS NULL    -- 軟刪防呆
  LOOP
    UPDATE public.expense_requests SET current_step = 0 WHERE id = r.id;
    PERFORM public._notify_expense_request_step(r.id, 0);   -- 重推關0(直屬主管)
    RAISE NOTICE '[fix] expense_request #% 已打回關0並重推', r.id;
  END LOOP;
END $$;

-- 驗證:跑完這 2 張 current_step 應為 0
-- SELECT id, status, current_step FROM public.expense_requests WHERE id IN (311,396);
