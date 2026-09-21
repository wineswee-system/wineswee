-- 刪除 104 匯入誤給兼職(PT)的 FT 滿額特休 — 2026-08-04
-- ════════════════════════════════════════════════════════════════════════════
-- 背景:2026-07-13 由 104 匯入批次,把每個兼職(salary_type='hourly')的特休都套成
--   FT 滿額天數而「沒有按 PT 比例打折」:
--     total_days=3(=24h,FT 首年滿6月)共 33 筆
--     total_days=7(=56h,FT 滿1年)  共  3 筆(莊浩隆/潘琦/李欣霏)
--   合計 36 筆(在職14 + 離職22)。老闆確認全刪。
-- 刪除後,假勤明細顯示退回 leave_annual_entitlement RPC 的「按比例」計算值;
--   待歷史班表匯入重算後即為正確值。
--
-- 安全:以精準 lb_id 逐筆刪,並加 leave_type='annual' + total_days IN (3,7) 守衛,
--   確保只刪「未打折的 FT 整數額度」。王澤昇 2025(#2644,total_days=1.875,15h,手動值)
--   天生被 total_days 守衛排除,不受影響。冪等(重跑不存在的 id 為 no-op)。
-- ════════════════════════════════════════════════════════════════════════════

DELETE FROM public.leave_balances
 WHERE id IN (
   -- 24h(total_days=3)33 筆
   2278, 2172, 2526, 2517, 2183, 2241, 2479, 2211, 2503, 2531,
   2488, 2298, 2308, 2474, 2541, 2566, 2556, 2498, 2571, 2512,
   2536, 2551, 2591, 2596, 2576, 2586, 2581, 2601, 2606, 2611,
   2616, 2626, 2621,
   -- 56h(total_days=7)3 筆
   2157, 2110, 2465
 )
   AND leave_type = 'annual'
   AND total_days IN (3, 7);   -- 守衛:只刪未打折的 FT 整數額度(排除 1.875 等手動值)

-- 驗證(跑完應回 0 筆):
-- SELECT lb.id, e.name, lb.year, lb.total_days
--   FROM public.leave_balances lb JOIN public.employees e ON e.id = lb.employee_id
--  WHERE e.salary_type='hourly' AND lb.leave_type='annual' AND lb.total_days IN (3,7);
