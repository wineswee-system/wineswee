-- 2026-08-12 第一年員工:§38 特休與舊系統「特休假2025結算」是同一份特休 → §38 該抵成剩0,只留結算為真餘額。
-- 現況:19 人已正確抵掉(如王竣禾 annual total3/used3 剩0 + 結算剩24),唯獨林襄沒抵(annual total3/used0 剩24)
--       → 她顯示 §38 24h + 結算 16h 重複。補抵:現行 §38(第一年 total<=3)used 補成 total,只留結算。
-- 範圍:僅命中「有特休假2025結算、現行§38第一年、且尚未抵」者 = 目前只有林襄 1 人。滿一年+(§38與結算不同份)不受影響。
UPDATE public.leave_balances a
   SET used_days = a.total_days
 WHERE a.leave_type = 'annual'
   AND a.total_days <= 3
   AND a.used_days < a.total_days
   AND (a.period_start IS NULL OR a.period_start <= CURRENT_DATE)
   AND (a.expires_at  IS NULL OR a.expires_at  >= CURRENT_DATE)
   AND EXISTS (
     SELECT 1 FROM public.leave_balances s
      WHERE s.employee_id = a.employee_id
        AND s.leave_type = '特休假2025結算'
        AND s.total_days > 0
   );
