-- 刪除許亦翎(#397)今天誤加的 5 小時補休 — 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- comp_time_ledger #125:5h、來源「手動加給」、2026-07-30 02:23 建立、未使用(hours_used=0)。
-- 誤加,刪除(補休 15.5h → 10.5h)。#124(昨天手動加給 5h)是正常的,保留。
-- WHERE 綁死 id+員工+時數+來源+未使用+active → 只刪這一筆,idempotent(重跑 0 筆)。
-- ════════════════════════════════════════════════════════════════════════════

DELETE FROM public.comp_time_ledger
 WHERE id = 125
   AND employee_id = 397
   AND hours = 5
   AND COALESCE(hours_used, 0) = 0
   AND source = '手動加給'
   AND status = 'active';
