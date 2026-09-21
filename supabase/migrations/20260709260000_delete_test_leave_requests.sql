-- 清除測試假單(理由=測試)
-- 2026-07-09  陳楷仁 特休顯示 已休8h/剩餘-8h,查出是一筆 reason='測試' 的已核准特休假單
--   (id27, 2026-05-14),他實際沒請過特休。年度假勤「已休」從已核准 leave_requests 算 → 被灌 8h。
--   另有洪伯嘉 2 筆事假測試單(id167 已退回、id168 待審核)。三筆皆測試資料,一併清除。
--   用明確 id,避免誤刪 reason 剛好含「測試」的真單。idempotent。

DELETE FROM public.leave_requests
WHERE id IN (27, 167, 168)
  AND reason = '測試';

NOTIFY pgrst, 'reload schema';
