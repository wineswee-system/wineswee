-- 2026-08-13 匯入兼職特休剩餘時數(來源:2026特休_兼職有請假剩餘時數名單.xlsx,人資已算好剩餘=已扣已休)。
-- 10 人,直接進 annual;區間照檔案;total=剩餘時數/8、used=0(之後請假自動扣)。
-- ★只刪「現在期」annual(period 含今天),保住黃為燁未來的正職期(2026-08-25~,7天FT)不被誤刪。
-- 年份照週年制(第一年6個月期=到職年;滿一年期=period起年),避免黃為燁現在/未來兩列同年打架。
-- 黃為燁:兼職轉正職→現在期給兼職算的11h(之前的給他),未來正職期維持7天不動。

DELETE FROM public.leave_balances
 WHERE leave_type = 'annual'
   AND employee_id IN (SELECT id FROM public.employees
        WHERE name IN ('王澤昇','莊浩隆','李欣霏','林則宇','黃為燁','洪瑛妏','李忠霖','黃瑋晴','江建賦','劉萱'))
   AND (period_start IS NULL OR period_start <= CURRENT_DATE)
   AND (expires_at  IS NULL OR expires_at  >= CURRENT_DATE);

INSERT INTO public.leave_balances
  (employee_id, leave_type, year, total_days, used_days, carry_over_days, period_start, expires_at, organization_id)
SELECT e.id, 'annual', s.year, s.remain_h / 8.0, 0, 0, s.ps, s.ex, e.organization_id
FROM (VALUES
  ('王澤昇', 2026, 44.5, DATE '2026-08-03', DATE '2027-08-02'),
  ('莊浩隆', 2026, 38.0, DATE '2026-07-05', DATE '2027-07-04'),
  ('李欣霏', 2026, 26.0, DATE '2026-06-16', DATE '2027-06-15'),
  ('林則宇', 2025,  8.0, DATE '2026-06-01', DATE '2026-11-30'),
  ('黃為燁', 2025, 11.0, DATE '2026-02-21', DATE '2026-08-20'),
  ('洪瑛妏', 2026,  3.5, DATE '2026-07-20', DATE '2027-01-19'),
  ('李忠霖', 2026,  6.0, DATE '2026-07-02', DATE '2027-01-01'),
  ('黃瑋晴', 2025,  6.5, DATE '2026-03-17', DATE '2026-09-16'),
  ('江建賦', 2026,  5.5, DATE '2026-07-19', DATE '2027-01-18'),
  ('劉萱',   2025,  7.0, DATE '2026-06-26', DATE '2026-12-25')
) AS s(name, year, remain_h, ps, ex)
JOIN public.employees e ON e.name = s.name;
