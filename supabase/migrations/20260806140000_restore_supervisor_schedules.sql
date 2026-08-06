-- 復原:換主要門市誤刪的督導班表(劉家君 emp75 / 陳嘉益 emp141)— 2026-08-06
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:EmployeeDetail.jsx 換主要門市(storeChanged)會刪該員工今天以後全部排班。
--   對單店員工合理,但督導(跨多店排班)被整批誤刪。洪伯嘉今天 08:06 換兩位督導
--   主要門市 → 劉家君 8/7~8/31(25 筆)、陳嘉益(3 筆)未來班表被刪。
-- 修:從 schedule_deletions.row_json(op='delete'、未還原)原樣 re-insert 回 schedules;
--   該員工該日已有班則跳過(不覆蓋新排的)。還原後標 restored_at 留痕、不重複還原。
--   前端 storeChanged 改成「先問再清」(另於 EmployeeDetail.jsx)。idempotent。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 管理動作:繞過班表鎖定 guard(該月若已鎖仍能還原)
SELECT set_config('schedules.bypass_lock', 'on', true);

-- 1) 原樣 re-insert(沿用原 id;已刪序號空著)。該員工該日已有班表則不覆蓋。
INSERT INTO public.schedules
SELECT (jsonb_populate_record(NULL::public.schedules, d.row_json)).*
FROM public.schedule_deletions d
WHERE d.op = 'delete'
  AND d.restored_at IS NULL
  AND d.employee_id IN (75, 141)
  AND NOT EXISTS (
    SELECT 1 FROM public.schedules s
     WHERE s.employee = d.employee AND s.date = d.date
  );

-- 2) 標記已還原(整批 op='delete' 未還原的都標,含少數已有班而跳過的,避免重複處理)
UPDATE public.schedule_deletions d
   SET restored_at = now(), restored_by_name = '系統批次還原(換門市誤刪)'
 WHERE d.op = 'delete'
   AND d.restored_at IS NULL
   AND d.employee_id IN (75, 141);

COMMIT;

NOTIFY pgrst, 'reload schema';
