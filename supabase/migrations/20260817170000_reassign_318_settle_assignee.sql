-- 老闆指示:#318(高雄富民冷氣保養,已核准待驗收)驗收人 張庭瑋(62) → 林巧玉(60)。
-- 冪等:只在目前還是 62 時改。改後 trg_notify_expense_settle_assignee 會通知新驗收人林巧玉。
UPDATE public.expense_requests
   SET settle_assignee_id = 60
 WHERE id = 318 AND settle_assignee_id = 62;
