-- ============================================================
-- Fix: leave_requests.type + leave_balances.leave_type 中文 → English code 正規化
--      leave_balances.used_days 從 leave_requests 重新計算（2026 年）
--
-- 問題根源：
--   1. bulk_import_leave 直接設 status='已核准'，繞過 secure_update_leave_status
--      → leave_balances.used_days 從未累計匯入的歷史資料
--   2. secure_update_leave_status 的 fallback CASE 只做中文→英文，
--      若 leave_balances.leave_type='特休' 而 leave_requests.type='annual'
--      → 兩次 UPDATE 都 miss → used_days 永遠不更新
--   3. leave_requests.type 混存中英文 → 任何計算只能撈到一半
-- ============================================================

BEGIN;

-- ─── 1. leave_requests.type 中文 → English code ──────────────────────
UPDATE public.leave_requests
SET type = CASE type
  WHEN '特休'       THEN 'annual'
  WHEN '特別休假'   THEN 'annual'
  WHEN '年假'       THEN 'annual'
  WHEN '年休假'     THEN 'annual'
  WHEN '年資特休'   THEN 'annual'
  WHEN '病假'       THEN 'sick'
  WHEN '事假'       THEN 'personal'
  WHEN '無薪假'     THEN 'unpaid'
  WHEN '公假'       THEN 'official'
  WHEN '產假'       THEN 'maternity'
  WHEN '陪產假'     THEN 'paternity'
  WHEN '生理假'     THEN 'menstrual'
  WHEN '婚假'       THEN 'marriage'
  WHEN '喪假'       THEN 'bereavement'
  WHEN '工傷假'     THEN 'occupational'
  WHEN '職災假'     THEN 'occupational'
  WHEN '家庭照顧假' THEN 'family_care'
  WHEN '家假'       THEN 'family_care'
  WHEN '心理健康假' THEN 'mental_health'
  WHEN '產檢假'     THEN 'prenatal'
  WHEN '育嬰假'     THEN 'parental'
  WHEN '育嬰留停'   THEN 'parental'
  WHEN '哺乳假'     THEN 'nursing'
  WHEN '護理假'     THEN 'nursing'
  WHEN '補休假'     THEN 'comp'
  WHEN '補休'       THEN 'comp'
  ELSE type  -- 謀職假、舊系統結算應休 等無標準對應的保留原文
END
WHERE type NOT IN (
  'annual','sick','personal','unpaid','official','maternity','paternity',
  'menstrual','marriage','bereavement','occupational','family_care',
  'mental_health','prenatal','parental','nursing','comp'
);

-- ─── 2. leave_balances.leave_type 中文 → English code ────────────────
UPDATE public.leave_balances
SET leave_type = CASE leave_type
  WHEN '特休'       THEN 'annual'
  WHEN '特別休假'   THEN 'annual'
  WHEN '年假'       THEN 'annual'
  WHEN '年休假'     THEN 'annual'
  WHEN '病假'       THEN 'sick'
  WHEN '事假'       THEN 'personal'
  WHEN '無薪假'     THEN 'unpaid'
  WHEN '公假'       THEN 'official'
  WHEN '產假'       THEN 'maternity'
  WHEN '陪產假'     THEN 'paternity'
  WHEN '生理假'     THEN 'menstrual'
  WHEN '婚假'       THEN 'marriage'
  WHEN '喪假'       THEN 'bereavement'
  WHEN '家庭照顧假' THEN 'family_care'
  WHEN '家假'       THEN 'family_care'
  WHEN '補休假'     THEN 'comp'
  WHEN '補休'       THEN 'comp'
  ELSE leave_type
END
WHERE leave_type NOT IN (
  'annual','sick','personal','unpaid','official','maternity','paternity',
  'menstrual','marriage','bereavement','occupational','family_care',
  'mental_health','prenatal','parental','nursing','comp'
);

-- ─── 3. 補建缺少的 leave_balances 列（有請假但沒餘額列的員工/假別）────
INSERT INTO public.leave_balances
  (employee_id, year, leave_type, total_days, used_days, carry_over_days, organization_id)
SELECT DISTINCT
  lr.employee_id,
  EXTRACT(YEAR FROM lr.start_date)::INT,
  lr.type,
  0,
  0,
  0,
  lr.organization_id
FROM public.leave_requests lr
WHERE EXTRACT(YEAR FROM lr.start_date) = 2026
  AND lr.status      = '已核准'
  AND lr.deleted_at  IS NULL
  AND lr.employee_id IS NOT NULL
ON CONFLICT (employee_id, year, leave_type) DO NOTHING;

-- ─── 4. 重算 2026 年 used_days ────────────────────────────────────────
-- unit='hour' 時 days 存的是「原始小時數」（e.g. 4h → days=4），需除以 8 轉天數
-- 優先用 hours 欄（更精確），沒有才 fallback 到 days/8
UPDATE public.leave_balances lb
SET
  used_days  = subq.total_used,
  updated_at = NOW()
FROM (
  SELECT
    employee_id,
    type AS leave_type,
    ROUND(COALESCE(SUM(
      CASE WHEN unit = 'hour'
           THEN COALESCE(hours, days::NUMERIC) / 8.0
           ELSE days::NUMERIC
      END
    ), 0), 1) AS total_used
  FROM public.leave_requests
  WHERE EXTRACT(YEAR FROM start_date) = 2026
    AND status      = '已核准'
    AND deleted_at  IS NULL
    AND employee_id IS NOT NULL
  GROUP BY employee_id, type
) subq
WHERE lb.employee_id = subq.employee_id
  AND lb.year        = 2026
  AND lb.leave_type  = subq.leave_type;

COMMIT;

-- ── 驗證查詢（手動執行確認）────────────────────────────────────────
-- SELECT e.name, lb.leave_type, lb.total_days, lb.used_days,
--        (lb.total_days + lb.carry_over_days - lb.used_days) AS remaining
-- FROM leave_balances lb
-- JOIN employees e ON e.id = lb.employee_id
-- WHERE lb.year = 2026 AND lb.leave_type = 'annual'
-- ORDER BY e.name;
