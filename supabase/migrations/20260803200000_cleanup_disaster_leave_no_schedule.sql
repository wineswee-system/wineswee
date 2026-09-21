-- 清理:撤掉「當天沒排上班班別」卻被建的天災無薪假 — 2026-08-03
-- ============================================================================
-- 病灶:舊版 disaster_settle_no_shows 的沒來清單只看「有無打卡」,沒看排班 → 把當天
--   本來就沒班(無排班 / 休 / 例假)的人也建了天災無薪假 → 誤扣。實測 7/10 共 64 張,
--   其中 32 張是沒上班班別的人。
-- 修:soft delete(deleted_at)這些「當天沒有上班班別」的天災無薪假;保留有排班的正確假單。
--   soft delete → 計薪與彙總都會排除(一律濾 deleted_at IS NULL),且可還原。idempotent。
-- 判定「有上班班別」= schedules 當天有列、actual_start 非空、shift 非(休/休息/例假/補休)。
-- ============================================================================
UPDATE public.leave_requests lr
   SET deleted_at = now()
 WHERE lr.reason LIKE '天災停班%'
   AND lr.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.schedules s
      WHERE s.employee_id = lr.employee_id
        AND s.date = lr.start_date
        AND s.actual_start IS NOT NULL
        AND COALESCE(s.shift,'') NOT IN ('休','休息','例假','補休')
   );

NOTIFY pgrst, 'reload schema';
