-- 修:跨午夜夜班的「整天假」被存成 end_date = 隔天(例:16:00-01:00 的班請 1 天生理假 → 存成 8/14~8/15)。
-- 後果:後台/LIFF 出勤把 start_date..end_date 逐日攤 → 隔天(另一個班、實際有上班)被誤標請假;
--       核准後蓋班表 trigger 也會把隔天的班蓋成假 → 計薪把有上班的日子當請假。
-- 判定:整天假(unit=day)且 days<=1 卻 end_date>start_date = 這種跨午夜溢出(1 天不可能橫跨 2 個日期)。
-- 範圍:只修「尚未核准」的(待審核/申請中),核准後 sync 才會蓋班表,趁未蓋前收正即可。
--       ★已核准的 7 張是歷史單、且班表已被 overlay 到隔天,需個別處理(不在此migration動,避免搞壞歷史班表/計薪)。
-- block trigger(trg_leave_block_edit_after_signed)會擋「已有簽核紀錄」的內容修改;此為系統 bug 的
--   資料修正,交易內暫停該 guard + sync 執行修正再還原。冪等。

ALTER TABLE public.leave_requests DISABLE TRIGGER trg_leave_block_edit_after_signed;
ALTER TABLE public.leave_requests DISABLE TRIGGER trg_leave_approval_sync_schedule;

UPDATE public.leave_requests
   SET end_date = start_date
 WHERE (unit = 'day' OR unit IS NULL)
   AND end_date > start_date
   AND days <= 1
   AND deleted_at IS NULL
   AND status IN ('待審核', '申請中');

ALTER TABLE public.leave_requests ENABLE TRIGGER trg_leave_block_edit_after_signed;
ALTER TABLE public.leave_requests ENABLE TRIGGER trg_leave_approval_sync_schedule;
