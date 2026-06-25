-- ════════════════════════════════════════════════════════════════════════════
-- 正規化 tasks.status：英文 'completed' → 中文 '已完成'
-- 2026-06-25
--
-- 病因：早期程式碼有些路徑寫入英文 'completed'（本 session 已修掉會寫英文的程式），
--   但舊資料殘留 20 筆 status='completed'。task-reminder 逾期/即將到期查詢只排除
--   中文「已完成/已取消」→ 這些其實已完成的單被當成逾期，誤發 LINE 逾期卡。
--
-- 修法：把殘留的英文 'completed' 一律改成 '已完成'，所有依狀態判斷的查詢一次乾淨。
--   只動 status 欄、只改 'completed' 這個值、不刪任何資料。idempotent（再跑 0 筆）。
-- （task-reminder 查詢同步加固成也排除英文 completed/cancelled 作為未來防呆。）
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.tasks
SET    status = '已完成'
WHERE  status = 'completed';
