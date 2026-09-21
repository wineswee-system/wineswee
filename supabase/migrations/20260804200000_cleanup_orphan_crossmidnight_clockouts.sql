-- 清理跨午夜下班孤兒打卡(6點換天漂移遺留)— 併回前日 + 刪重複 — 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:_apply_correction_to_attendance 漂移期間(見 20260804180000 已還原),夜班
--   00:00~06:00 的下班補卡照日曆日建了「無上班、只有下班」的孤兒。全公司 21 筆(李欣霏
--   8/4 #4871 已於 190000 先清)。
-- 處理(依 6 點換天規則,下班歸前一天):
--   (A) 前日「有上班、沒下班」→ 把孤兒的下班併回前日、重算淨工時(扣休息)、刪孤兒。15 筆。
--   (B) 前日「已有下班」(重複)→ 孤兒冗餘、0 工時 → 直接刪。6 筆。
-- 老闆已確認長班(白天上班~午夜)對這些員工正常,21 筆全做。
-- ★影響薪資工時(7月為主):把前日缺下班補成完整班 → 7 月薪資若已結需重跑該員。
-- set-based + 防呆(只處理符合孤兒定義者);idempotent(重跑:孤兒已清→無事)。
-- 還原用:併回=把該前日 clock_out 改回 NULL、重建孤兒;下為處理前明細(供回溯):
--   (A)併回 orphan→prev,new_out:
--     #4947→#4948(01:00) #4908→#4466(00:00) #4894→#4402(02:00) #4925→#4344(00:00)
--     #4911→#4300(00:00) #4897→#4898(05:00) #4907→#4917(00:00) #4930→#4931(00:20)
--     #4891→#4934(00:00) #4936→#3729(00:00) #4937→#3745(00:06) #4884→#4885(01:00)
--     #4904→#2185(00:00) #4912→#4913(00:00) #4883→#4942(01:00)
--   (B)重複刪:#4881 #4901 #4877 #4887 #4870 #4910
-- ════════════════════════════════════════════════════════════════════════════

-- 併回目標(只收「前日有上班沒下班」的拆開案;重複案不進此表)
DROP TABLE IF EXISTS _att_orphan_merge;
CREATE TEMP TABLE _att_orphan_merge AS
SELECT p.id AS prev_id, o.id AS orphan_id, o.clock_out AS new_out
  FROM public.attendance_records o
  JOIN public.attendance_records p
    ON p.employee_id = o.employee_id AND p.date = o.date - 1
 WHERE o.clock_in IS NULL AND o.clock_out IS NOT NULL
   AND o.clock_out < time '06:00:00' AND o.status = '補登'
   AND p.clock_in IS NOT NULL AND p.clock_out IS NULL;

-- (A) 併回:前日補上下班時間
UPDATE public.attendance_records a
   SET clock_out = m.new_out, clock_out_mode = 'normal'
  FROM _att_orphan_merge m
 WHERE a.id = m.prev_id AND a.clock_out IS NULL;

-- (A) 重算前日淨工時(跨午夜 +24;扣休息 <5h=0、5~9h=30分、≥9h=60分)
UPDATE public.attendance_records a
   SET total_hours = ROUND((gh.gross - public._attendance_rest_minutes(a.employee_id, gh.gross) / 60.0)::numeric, 2)
  FROM (
    SELECT id,
           CASE WHEN EXTRACT(EPOCH FROM (clock_out - clock_in)) < 0
                THEN EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0 + 24
                ELSE EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0 END AS gross
      FROM public.attendance_records
     WHERE id IN (SELECT prev_id FROM _att_orphan_merge)
  ) gh
 WHERE a.id = gh.id;

-- (A)+(B) 刪掉所有孤兒(併回後冗餘 + 重複)
DELETE FROM public.attendance_records
 WHERE clock_in IS NULL AND clock_out IS NOT NULL
   AND clock_out < time '06:00:00' AND status = '補登';

DROP TABLE IF EXISTS _att_orphan_merge;
NOTIFY pgrst, 'reload schema';
