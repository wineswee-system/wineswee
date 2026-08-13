-- 2026-08-13 恢復黃為燁 特休假2025結算=整11h(前一步該列意外消失;他的特休11h要靠這列顯示,annual已抵成剩0)。
DELETE FROM public.leave_balances
 WHERE employee_id = (SELECT id FROM public.employees WHERE name = '黃為燁')
   AND leave_type = '特休假2025結算';
INSERT INTO public.leave_balances
  (employee_id, leave_type, year, total_days, used_days, carry_over_days, period_start, expires_at, organization_id)
SELECT id, '特休假2025結算', 2026, 11.0/8.0, 0, 0, DATE '2026-01-01', DATE '2026-12-31', organization_id
FROM public.employees WHERE name = '黃為燁';
