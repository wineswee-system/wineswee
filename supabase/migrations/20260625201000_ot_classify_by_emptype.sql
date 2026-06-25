-- ════════════════════════════════════════════════════════════════════════════
-- 加班分類 v2：DOW fallback 只給行政(admin)，門市正職/PT 四週變形不用週幾推休息日
-- 2026-06-25
--
-- 問題：classify_overtime_category_v2 會讀班表(例假/休息/國定),但「沒排班標示」時
--   一律 fallback 用 DOW(週六→restday、週日→weekly_off)。這對四週變形的人是錯的：
--   - PT 只有班別/空白、沒有休息日概念 → 週末加班被誤判 restday ×2(例:李建廷 5/02)
--   - 門市正職也是四週變形,休息看班表不是看週幾
-- 只有「行政(employment_category='admin',固定週一~五)」才適用週六=休息、週日=例假。
--
-- 修法：v2 在「班表沒明確標休息/例假」後，只有 admin 才走 DOW，其餘一律 weekday。
--   國定假日(holidays 或 班表'國定假')仍最高優先,對所有人 ×holiday。
-- trigger 已用 v2(20260608000000),改 v2 即生效;再 backfill 既有資料。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.classify_overtime_category_v2(
  p_date        DATE,
  p_employee_id INT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_is_holiday   BOOLEAN;
  v_shift        TEXT;
  v_dow          INT;
  v_emp_category TEXT;
BEGIN
  IF p_date IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1. 國定假日（月曆）最高優先，對所有人一律 holiday
  SELECT EXISTS (
    SELECT 1 FROM public.holidays
    WHERE date = p_date AND COALESCE(is_workday, false) = false
  ) INTO v_is_holiday;
  IF v_is_holiday THEN
    RETURN 'holiday';
  END IF;

  -- 2. 看員工該日排班 shift（明確標示優先）
  IF p_employee_id IS NOT NULL THEN
    SELECT s.shift INTO v_shift
      FROM public.schedules s
      JOIN public.employees e ON e.name = s.employee
     WHERE e.id = p_employee_id
       AND s.date = p_date
     LIMIT 1;

    IF v_shift = '國定假' THEN
      RETURN 'holiday';
    ELSIF v_shift = '例假' THEN
      RETURN 'weekly_off';
    ELSIF v_shift IN ('休', '休息') THEN
      RETURN 'restday';
    END IF;

    -- 員工類型：只有「行政(admin)」固定週一~五，才用 DOW 推休息日/例假
    SELECT ss.employment_category INTO v_emp_category
      FROM public.salary_structures ss
     WHERE ss.employee_id = p_employee_id
     LIMIT 1;
  END IF;

  -- 3. 行政 → DOW fallback；門市正職/PT(四週變形)沒班表休息標示 → 一律 weekday
  IF COALESCE(v_emp_category, '') = 'admin' THEN
    v_dow := EXTRACT(DOW FROM p_date)::INT;
    IF v_dow = 0 THEN
      RETURN 'weekly_off';
    ELSIF v_dow = 6 THEN
      RETURN 'restday';
    END IF;
  END IF;

  RETURN 'weekday';
END $$;

-- ── Backfill 既有 OT：用新 v2 重算 ot_category（只動會變的）──
UPDATE public.overtime_requests ot
   SET ot_category = public.classify_overtime_category_v2(COALESCE(ot.request_date, ot.date), ot.employee_id)
 WHERE COALESCE(ot.request_date, ot.date) IS NOT NULL
   AND ot.ot_category IS DISTINCT FROM
       public.classify_overtime_category_v2(COALESCE(ot.request_date, ot.date), ot.employee_id);

COMMIT;

NOTIFY pgrst, 'reload schema';
