-- 2026-08-13 刪洪伯嘉手動加給補休 id123(8h,source=手動加給,未連加班單、未使用/預留)—用戶明確確認刪。
DELETE FROM public.comp_time_ledger
 WHERE id = 123 AND source = '手動加給' AND overtime_request_id IS NULL
   AND hours_used = 0 AND hours_reserved = 0;
