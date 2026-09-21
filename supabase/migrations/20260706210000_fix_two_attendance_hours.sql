-- 修：兩單工時算錯，一次性校正（不做全庫浮動 backfill，只改這兩單）
-- 2026-07-06
-- 1) 詹健如 2026-07-01 (id 1995)：09:17→18:18，total_hours=9（沒扣休息）→ 應 8.02
-- 2) 張庭瑋 2026-07-03 (id 2129, 外出)：10:00→19:39，total_hours=0（沒算工時）→ 應 8.65
-- 修法：由 clock_in/clock_out 重算「淨工時」= 毛時數 − 休息（calc_shift_rest_minutes：
--   <5h=0、5~9h=30分、≥9h=60分），跨午夜 +24h。只鎖這兩個 id。
-- idempotent：重算恆得同值；只碰 id IN (1995,2129) 且兩端都有打卡的列。

UPDATE public.attendance_records a
   SET total_hours = ROUND((g.gross - public.calc_shift_rest_minutes(g.gross) / 60.0)::numeric, 2),
       hours       = ROUND((g.gross - public.calc_shift_rest_minutes(g.gross) / 60.0)::numeric, 2)
  FROM (
    SELECT id,
           CASE WHEN EXTRACT(EPOCH FROM (clock_out - clock_in)) < 0
                THEN EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0 + 24
                ELSE EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0 END AS gross
      FROM public.attendance_records
     WHERE id IN (1995, 2129)
       AND clock_in IS NOT NULL AND clock_out IS NOT NULL
  ) g
 WHERE a.id = g.id;
