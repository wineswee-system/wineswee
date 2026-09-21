-- ════════════════════════════════════════════════════════════════════════════
-- 清除無名孤兒薪資紀錄（2026-04 測試殘留）
-- 2026-06-22
--
-- salary_records id=44：employee 為 NULL（2026-04 永春薪資測試期間手動塞入的測試列），
-- 列表會多一列「–」。現行程式已無法產生 null 名字（手動新增擋 form.employee、
-- 批次一律帶 employee），故為一次性孤兒。已於 Studio 手動刪除，這支只是把動作補進版控。
-- 條件鎖死 id + employee IS NULL + month + org，idempotent（row 已不在則刪 0 筆）。
-- ════════════════════════════════════════════════════════════════════════════

DELETE FROM public.salary_records
WHERE id = 44
  AND employee IS NULL
  AND month = '2026-04'
  AND organization_id = 1;
