-- 刪除中山國小 2026-08 的 draft 排班 — 2026-07-07
-- 背景：這批 40 筆是 2026-05-29 一次 bulk seed 灌進來的（source_store=null、status=draft、
--       班別格式不一致如「11~20」混「11:00~17:00」），非人工在排班畫面排的；
--       八月尚未該有正式班表，使用者確認刪除。
-- 範圍：中山國小 11 位員工的 employee_id（用 id 精準界定，避開 schedules 用姓名比對的跨店撞名風險）
--       × 2026-08 × status='draft'。全 draft、未發布、未鎖定、八月未結薪 → 無計薪/發布牽連。
-- idempotent：刪過再跑刪 0 筆。注意 DELETE 不可逆，但此為 draft 種子資料、需要時可重新產生。

DELETE FROM public.schedules
 WHERE employee_id IN (75, 76, 77, 78, 79, 80, 81, 212, 391, 405, 406)
   AND date >= '2026-08-01' AND date <= '2026-08-31'
   AND status = 'draft';

-- 若要「全門市八月」一起清（另含中信南港 6/11 建立的 3 筆 draft），改跑下面這段（預設註解掉）：
-- DELETE FROM public.schedules
--  WHERE date >= '2026-08-01' AND date <= '2026-08-31' AND status = 'draft';
