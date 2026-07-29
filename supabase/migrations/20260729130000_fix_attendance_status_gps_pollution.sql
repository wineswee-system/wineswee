-- 修 attendance_records.status 被匯入誤寫成 GPS 經度:把經度搬回正確欄位 — 2026-07-29
-- ════════════════════════════════════════════════════════════════════════════
-- 病灶:2026-04 歷史考勤在 5-6 月手動匯入(method=manual)時,把「上班打卡經度」對錯到
--   status 欄,導致 1079 筆 status 是經度字串(如 '121.534555')而非狀態值。
--   經核對:全部 1079 筆都落在台灣經度 120.3~121.6(0 筆超出),且各筆 clock_in_lng 皆空,
--   緯度沒一起匯入(遺失)。即時打卡流程乾淨(7 月 0 髒),無程式碼要改,僅回填舊資料。
-- 做法(搬移而非刪除,保留資料):
--   1. 先把 status 的經度搬回 clock_in_lng(僅該欄還空時,不蓋真值)。
--   2. 再把 status 回填成正確狀態(原狀態已被覆蓋、無法還原 → 依打卡狀況重推)。
-- idempotent:WHERE 綁「status 是純數字座標」;搬移後 clock_in_lng 有值、status 非座標 → 重跑 0 筆。
-- ════════════════════════════════════════════════════════════════════════════

-- 1. 經度搬回 clock_in_lng(不覆蓋既有真值)
UPDATE public.attendance_records
   SET clock_in_lng = status::double precision
 WHERE status ~ '^-?\d+\.\d+$'
   AND clock_in_lng IS NULL
   AND status::double precision BETWEEN 119 AND 123;   -- 保險:確定是台灣經度才搬

-- 2. status 回填成正確狀態
UPDATE public.attendance_records
   SET status = CASE
     WHEN clock_in IS NOT NULL AND clock_out IS NOT NULL AND COALESCE(is_late, false) THEN '遲到'
     WHEN clock_in IS NOT NULL AND clock_out IS NOT NULL THEN '正常'
     WHEN clock_in IS NOT NULL OR  clock_out IS NOT NULL THEN '缺卡'
     ELSE '未打卡'
   END
 WHERE status ~ '^-?\d+\.\d+$';
