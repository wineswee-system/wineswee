-- 修正連鎖夜班下班日歸屬(6點換天漂移遺留)— 4 人逐日校正 — 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:_apply_correction_to_attendance 漂移期間(見 20260804180000 已還原),夜班
--   00:00~06:00 下班補卡照日曆日套 → 下班整條晚一天。李欣霏/趙亭威/温子杰/潘胤傑受影響:
--   某日缺下班(其下班卡跑到隔天),隔天多一筆「殘留」下班。
-- 判準(唯讀乾跑驗過):某日 X 正確下班 = 補卡填在 X+1、<6點者(boundary 落 X);
--   X 的殘留 = X 現有下班 = 「填在 X 當天<6點」的補卡值(那張其實屬 X-1)。真實打卡不動。
-- 做法:逐日明確 UPDATE(可稽核,不用聰明 SQL),再重算淨工時。idempotent。
-- ★排除趙亭威 7/09(上班卡=00:00 本身壞資料,填會變 23h)→ 留手動處理,連帶 7/10 不動。
-- ★影響 7 月薪資工時 → 已結需重跑這 4 人。
-- ════════════════════════════════════════════════════════════════════════════

-- ── 逐日校正(new_out NULL = 清殘留)──
WITH fix(emp, d, new_out) AS (VALUES
  -- 李欣霏 98
  (98,  DATE '2026-07-18', TIME '01:00'),
  (98,  DATE '2026-07-19', NULL::time),
  (98,  DATE '2026-08-02', TIME '00:00'),
  -- 趙亭威 134(排除 7/09、7/10)
  (134, DATE '2026-07-03', TIME '02:00'),
  (134, DATE '2026-07-04', NULL::time),
  (134, DATE '2026-07-12', TIME '00:00'),
  (134, DATE '2026-07-17', TIME '02:00'),
  (134, DATE '2026-07-18', NULL::time),
  (134, DATE '2026-07-22', TIME '00:00'),
  (134, DATE '2026-07-23', NULL::time),
  -- 温子杰 122
  (122, DATE '2026-07-10', TIME '01:30'),
  (122, DATE '2026-07-12', TIME '00:30'),
  (122, DATE '2026-07-31', TIME '01:30'),
  (122, DATE '2026-08-01', NULL::time),
  -- 潘胤傑 101
  (101, DATE '2026-07-03', TIME '01:00'),
  (101, DATE '2026-07-04', NULL::time),
  (101, DATE '2026-07-07', TIME '00:00'),
  (101, DATE '2026-07-13', TIME '00:00'),
  (101, DATE '2026-07-14', NULL::time),
  (101, DATE '2026-07-29', TIME '00:00'),
  (101, DATE '2026-07-30', NULL::time)
)
UPDATE public.attendance_records a
   SET clock_out      = f.new_out,
       clock_out_mode = CASE WHEN f.new_out IS NULL THEN a.clock_out_mode ELSE 'normal' END
  FROM fix f
 WHERE a.employee_id = f.emp AND a.date = f.d;

-- ── 重算受影響日的淨工時(兩端齊→算,清空→NULL;扣休息 <5h=0、5~9h=30分、≥9h=60分)──
UPDATE public.attendance_records a
   SET total_hours = CASE
     WHEN a.clock_in IS NULL OR a.clock_out IS NULL THEN NULL
     ELSE ROUND((gh.gross - public._attendance_rest_minutes(a.employee_id, gh.gross) / 60.0)::numeric, 2)
   END
  FROM (
    SELECT id,
           CASE WHEN EXTRACT(EPOCH FROM (clock_out - clock_in)) < 0
                THEN EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0 + 24
                ELSE EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0 END AS gross
      FROM public.attendance_records
     WHERE (employee_id, date) IN (
       (98, DATE '2026-07-18'),(98, DATE '2026-07-19'),(98, DATE '2026-08-02'),
       (134,DATE '2026-07-03'),(134,DATE '2026-07-04'),(134,DATE '2026-07-12'),(134,DATE '2026-07-17'),(134,DATE '2026-07-18'),(134,DATE '2026-07-22'),(134,DATE '2026-07-23'),
       (122,DATE '2026-07-10'),(122,DATE '2026-07-12'),(122,DATE '2026-07-31'),(122,DATE '2026-08-01'),
       (101,DATE '2026-07-03'),(101,DATE '2026-07-04'),(101,DATE '2026-07-07'),(101,DATE '2026-07-13'),(101,DATE '2026-07-14'),(101,DATE '2026-07-29'),(101,DATE '2026-07-30')
     )
  ) gh
 WHERE a.id = gh.id;

NOTIFY pgrst, 'reload schema';
