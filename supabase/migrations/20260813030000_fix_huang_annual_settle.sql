-- 2026-08-13 黃為燁(兼職轉正職)特休整理:比照其他正職(§38那列抵成剩0、特休假2025結算=真值)。
--   ①annual現在期 used=total → 剩0(特休歸零) ②特休假2025結算 修成整11h(1.375天;舊值1.38=11.04h不乾淨)
--   ③刪重複的「兼職特休」列(1.4天=11.2h,同一份~11h重複)。未來正職期(annual 2026,7天)不動。
UPDATE public.leave_balances
   SET used_days = total_days
 WHERE employee_id = (SELECT id FROM public.employees WHERE name = '黃為燁')
   AND leave_type = 'annual'
   AND period_start <= CURRENT_DATE AND expires_at >= CURRENT_DATE;

UPDATE public.leave_balances
   SET total_days = 11.0/8.0, used_days = 0
 WHERE employee_id = (SELECT id FROM public.employees WHERE name = '黃為燁')
   AND leave_type = '特休假2025結算';

DELETE FROM public.leave_balances
 WHERE employee_id = (SELECT id FROM public.employees WHERE name = '黃為燁')
   AND leave_type = '兼職特休';
