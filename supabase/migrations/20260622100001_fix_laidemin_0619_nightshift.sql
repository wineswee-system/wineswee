-- ════════════════════════════════════════════════════════════════════════════
-- 修：賴德旻(emp 403) 06-19 跨午夜夜班被誤拆成兩筆
-- 2026-06-22
--
-- 成因：跨午夜後 LIFF 誤顯示「上班」鈕(已於 LIFF Clock workDay 修正)，員工 01:04 誤按
--   上班(生出 06-20 id=1913 clock_in=clock_out=01:04 空紀錄)，把 06-19 的班丟著(無下班)。
-- 修復：
--   1) 06-19(id=1911) 補上下班 01:04(實際下班時刻 06-20 01:04)，total_hours=6.62
--      （gross 17:57→01:04 = 427 分 = 7.12h，扣 30 分休息 = 397 分 = 6.62h）
--   2) 刪掉 06-20(id=1913) 那筆 in=out 空紀錄
--
-- 防呆：WHERE 帶 id+員工+日期+原值，已修過 / 值不符 → 不動（idempotent）。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.attendance_records
   SET clock_out      = '01:04:00',
       clock_out_time = '2026-06-19T17:04:58+00'::timestamptz,
       total_hours    = 6.62,
       clock_out_mode = 'normal'
 WHERE id = 1911 AND employee_id = 403 AND date = '2026-06-19'
   AND clock_in = '17:57:00' AND clock_out IS NULL;

DELETE FROM public.attendance_records
 WHERE id = 1913 AND employee_id = 403 AND date = '2026-06-20'
   AND clock_in = '01:04:00' AND clock_out = '01:04:00';

COMMIT;
