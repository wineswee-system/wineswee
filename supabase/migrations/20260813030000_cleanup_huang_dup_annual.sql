-- 2026-08-13 清黃為燁重複特休列:兼職轉正職後,他有 annual(匯入11h) + 兼職特休(11.2h,舊手動) +
--   特休假2025結算(11.04h,舊系統) 三份同一份~11h疊著顯示。留匯入的 annual,刪兩個重複殘留列。
--   (全庫僅黃為燁有此兩列;其他9位PT乾淨。)
DELETE FROM public.leave_balances
 WHERE employee_id = (SELECT id FROM public.employees WHERE name = '黃為燁')
   AND leave_type IN ('兼職特休', '特休假2025結算');
