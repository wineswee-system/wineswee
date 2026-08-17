-- 老闆指示:劉家君/陳嘉益/趙亭威/黃蘊珊/張庭瑋 5 人「2025特休結算」各多 24 小時(=3 天,8h/天)。
-- 有結算列的 3 人 → 設為明確目標值(現值+3,冪等);沒列的 2 人(2025特休用光無結算)→ 新建 3 天列(冪等 NOT EXISTS)。
UPDATE public.leave_balances SET total_days = 23.12, updated_at = now() WHERE id = 2679;  -- 張庭瑋 20.12+3
UPDATE public.leave_balances SET total_days = 10.0,  updated_at = now() WHERE id = 2682;  -- 趙亭威 7.0+3
UPDATE public.leave_balances SET total_days = 5.75,  updated_at = now() WHERE id = 2681;  -- 黃蘊珊 2.75+3

INSERT INTO public.leave_balances (employee_id, year, leave_type, total_days, used_days, carry_over_days, expires_at, period_start, organization_id)
SELECT 75, 2026, '特休假2025結算', 3.0, 0, 0, DATE '2026-12-31', DATE '2026-01-01', 1
WHERE NOT EXISTS (SELECT 1 FROM public.leave_balances WHERE employee_id=75 AND leave_type='特休假2025結算');
INSERT INTO public.leave_balances (employee_id, year, leave_type, total_days, used_days, carry_over_days, expires_at, period_start, organization_id)
SELECT 141, 2026, '特休假2025結算', 3.0, 0, 0, DATE '2026-12-31', DATE '2026-01-01', 1
WHERE NOT EXISTS (SELECT 1 FROM public.leave_balances WHERE employee_id=141 AND leave_type='特休假2025結算');

-- 使用區間統一 2026-01-01 ~ 2026-12-31(到期未休→計薪引擎自動折現,現有機制)
UPDATE public.leave_balances
   SET period_start = DATE '2026-01-01', expires_at = DATE '2026-12-31', updated_at = now()
 WHERE leave_type = '特休假2025結算' AND employee_id IN (75, 62, 134, 141, 148);
