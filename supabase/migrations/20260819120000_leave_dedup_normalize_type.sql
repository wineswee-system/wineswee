-- ════════════════════════════════════════════════════════════════════════════
-- 請假紀錄去重 + type 統一成名稱 — 2026-08-19
-- ════════════════════════════════════════════════════════════════════════════
-- 問題:部分假被灌兩份(舊批次存代碼 personal/sick…、新批次存名稱 事假/病假…),
--   同一天同時數各一筆 → WEB(兩份都加)超收、LIFF/送出(只認名稱)漏算,三畫面不一致。
-- 修:① 把「有名稱雙胞胎的舊代碼列」備份後刪除(保留名稱那份,假不消失);
--     ② 其餘還存代碼的事件假別 type 統一成名稱(排除 annual/comp_time/maternity 特殊處理)。
-- _leave_code_to_shift 名稱/代碼都吃 → 排班覆蓋不受影響。全 idempotent,刪的先備份可還原。
-- ★ 純資料清理:暫停所有 user trigger(排班鎖/已簽禁改/通知/稽核),避免刪已核准假去
--   revert 已鎖排班而被擋、或狂發通知。留下的名稱那份仍蓋著班表 → 排班不變。
-- ════════════════════════════════════════════════════════════════════════════

SET session_replication_role = 'replica';

-- ① 備份要刪的重複列(可還原)
CREATE TABLE IF NOT EXISTS public._leave_dedup_backup_20260819 AS SELECT * FROM public.leave_requests WHERE false;

INSERT INTO public._leave_dedup_backup_20260819
SELECT b.*
FROM public.leave_requests b
JOIN public.leave_types lt ON b.type = lt.code AND lt.name <> lt.code
JOIN public.leave_requests a
  ON a.employee_id = b.employee_id AND a.start_date = b.start_date
     AND COALESCE(a.hours, a.days*8) = COALESCE(b.hours, b.days*8)
     AND a.type = lt.name AND a.id <> b.id
     AND a.status NOT IN ('已拒絕','已退回','已駁回','已取消')
WHERE b.status NOT IN ('已拒絕','已退回','已駁回','已取消')
  AND NOT EXISTS (SELECT 1 FROM public._leave_dedup_backup_20260819 x WHERE x.id = b.id);

-- ② 刪掉那些重複代碼列(留名稱那份)
DELETE FROM public.leave_requests b
USING public.leave_types lt, public.leave_requests a
WHERE b.type = lt.code AND lt.name <> lt.code
  AND a.employee_id = b.employee_id AND a.start_date = b.start_date
  AND COALESCE(a.hours, a.days*8) = COALESCE(b.hours, b.days*8)
  AND a.type = lt.name AND a.id <> b.id
  AND a.status NOT IN ('已拒絕','已退回','已駁回','已取消')
  AND b.status NOT IN ('已拒絕','已退回','已駁回','已取消');

-- ③ 其餘還存代碼的事件假別 type 統一成名稱(排除特休/補休/產假特殊處理)
UPDATE public.leave_requests lr
SET type = lt.name
FROM public.leave_types lt
WHERE lr.type = lt.code AND lt.name <> lt.code
  AND lt.code NOT IN ('annual', 'comp_time', 'maternity');

SET session_replication_role = 'origin';

NOTIFY pgrst, 'reload schema';
