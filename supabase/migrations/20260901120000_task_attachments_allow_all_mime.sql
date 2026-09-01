-- 2026-09-01 任務附件:放行所有檔案類型(對齊 UI「支援所有檔案類型(不含執行檔),單檔 10MB」)
--
-- 問題:task-attachments bucket 的 allowed_mime_types 只白名單 pdf/word/excel/圖片,
--   PowerPoint(.ppt/.pptx)、txt、zip、影片…全被 Storage 擋掉,且前端錯誤被靜默吞。
--   與 UI 承諾「支援所有檔案類型(不含執行檔)」不符。
--
-- 修法:allowed_mime_types = NULL(允許全部),與 attachments bucket 一致。
--   執行檔仍由前端 validateTaskFile(BLOCKED_EXT: exe/bat/sh/cmd/ps1/scr/vbs/msi/com)best-effort 擋。
--   (Storage 的 allowed_mime_types 是白名單、無法表達「除了 exe 以外全部」,故執行檔守在客戶端。)

UPDATE storage.buckets
   SET allowed_mime_types = NULL
 WHERE id = 'task-attachments';
