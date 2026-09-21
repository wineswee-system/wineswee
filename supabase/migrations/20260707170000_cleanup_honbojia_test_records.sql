-- 清掉洪伯嘉(id 10)6月的髒資料 — 2026-07-07
-- 1) 6/1 打卡(id 326)：到職記錄是 6/22，這筆在到職前，屬髒資料。
-- 2) 6/30 三筆加班：source=manual、原因「測試」，非本人申請、非104匯入，屬測試單。
-- 只鎖 employee_id=10 + 明確條件，idempotent（刪過再跑刪 0 筆）。不影響其他人。

DELETE FROM public.attendance_records
 WHERE employee_id = 10 AND date = '2026-06-01';

DELETE FROM public.overtime_requests
 WHERE employee_id = 10 AND date = '2026-06-30' AND reason = '測試';
