-- ════════════════════════════════════════════════════════════════════════════
-- Fix 1: monthly_attendance_diff LATE 偵測改 inline 算（不依賴壞掉的 is_late）
-- Fix 2A: 加 commit_attendance_diff_writeback RPC，把 LATE 寫回 attendance_records
--
-- 背景：
--   - clock-in Edge Function 2026-05-28 簡化後寫死 late_minutes=0/is_late=false
--   - 原 monthly_attendance_diff 讀這兩欄判斷 LATE → 永遠抓不到
--   - 批次計薪讀 attendance_records.late_minutes 算遲到扣薪/全勤獎金 → 全失效
--
-- 修法：
--   1. monthly_attendance_diff 重寫 LATE 條件，改用 clock_in TIME − actual_start TIME
--      ＊ MISSING/OVERWORK/UNDERTIME/UNSCHEDULED 邏輯不動，那些不靠 is_late
--      ＊ 不存在 actual_start 的舊資料還是抓不到，這個維持原樣
--   2. 新增 commit_attendance_diff_writeback(p_year_month, p_store_id)
--      ＊ 先把該月 attendance_records.late_minutes/is_late 重置 0/false
--      ＊ 再對每位員工跑 monthly_attendance_diff，把 LATE row 寫回
--      ＊ 寫回後 Salary.jsx 批次計薪會自然讀到正確值
--
-- 安全：function 全寫 SECURITY DEFINER + SET search_path 防注入
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1. monthly_attendance_diff：LATE 改 inline 算
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.monthly_attendance_diff(
  p_employee_id INT,
  p_year_month  TEXT
)
RETURNS TABLE (
  diff_date       DATE,
  diff_type       TEXT,
  expected_shift  TEXT,
  expected_start  TEXT,
  expected_end    TEXT,
  expected_hours  NUMERIC,
  actual_clock_in  TEXT,
  actual_clock_out TEXT,
  actual_hours    NUMERIC,
  diff_value      NUMERIC,
  message         TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month_start    DATE;
  v_month_end      DATE;
  v_late_tolerance INT;
  v_store_id       INT;
  v_join_date      DATE;
  v_resign_date    DATE;
  v_emp_name       TEXT;
BEGIN
  v_month_start := to_date(p_year_month || '-01', 'YYYY-MM-DD');
  v_month_end   := (v_month_start + INTERVAL '1 month - 1 day')::DATE;

  SELECT name, store_id, join_date, resign_date
    INTO v_emp_name, v_store_id, v_join_date, v_resign_date
  FROM employees WHERE id = p_employee_id;

  IF v_emp_name IS NULL THEN RETURN; END IF;
  IF v_join_date IS NOT NULL AND v_join_date > v_month_end THEN RETURN; END IF;
  IF v_resign_date IS NOT NULL AND v_resign_date < v_month_start THEN RETURN; END IF;

  SELECT COALESCE(late_tolerance_minutes, 5) INTO v_late_tolerance
  FROM stores WHERE id = v_store_id;
  IF v_late_tolerance IS NULL THEN v_late_tolerance := 5; END IF;

  RETURN QUERY
  WITH
    days AS (
      SELECT d::DATE AS day
      FROM generate_series(
        GREATEST(v_month_start, COALESCE(v_join_date, v_month_start)),
        LEAST(v_month_end, COALESCE(v_resign_date, v_month_end)),
        '1 day'::INTERVAL
      ) d
    ),
    sched AS (
      SELECT s.date, s.shift, s.actual_start, s.actual_end, COALESCE(s.actual_hours, 0) AS actual_hours
      FROM schedules s
      WHERE (s.employee_id = p_employee_id OR s.employee = v_emp_name)
        AND s.date BETWEEN v_month_start AND v_month_end
    ),
    att AS (
      SELECT a.date,
             a.clock_in,
             a.clock_out,
             COALESCE(a.total_hours, 0) AS total_hours
      FROM attendance_records a
      WHERE a.employee_id = p_employee_id
        AND a.date BETWEEN v_month_start AND v_month_end
    ),
    covered AS (
      SELECT generate_series(start_date, end_date, '1 day'::INTERVAL)::DATE AS d
      FROM leave_requests
      WHERE (employee_id = p_employee_id OR employee = v_emp_name)
        AND status IN ('已核准', '待審核')
        AND start_date <= v_month_end AND end_date >= v_month_start
      UNION
      SELECT date FROM overtime_requests
      WHERE (employee_id = p_employee_id OR employee = v_emp_name)
        AND status IN ('已核准', '待審核')
        AND date BETWEEN v_month_start AND v_month_end
      UNION
      SELECT date FROM clock_corrections
      WHERE (employee_id = p_employee_id OR employee = v_emp_name)
        AND status IN ('已核准', '待審核')
        AND date BETWEEN v_month_start AND v_month_end
      UNION
      SELECT generate_series(start_date, end_date, '1 day'::INTERVAL)::DATE AS d
      FROM business_trips
      WHERE employee = v_emp_name
        AND status IN ('已核准', '待審核')
        AND start_date IS NOT NULL AND end_date IS NOT NULL
        AND start_date <= v_month_end AND end_date >= v_month_start
    ),
    work_sched AS (
      SELECT * FROM sched
      WHERE shift IS NOT NULL
        AND shift NOT IN ('休', '補休', '特休', '病', '事', '婚', '喪', '公', '產', '生',
                          '工傷', '陪產', '會議', '未入職', '已離職')
    ),
    -- ★ Fix 1：inline 算 late_minutes，不靠 attendance_records.is_late ★
    -- 只在 ws.date 存在（有班）且 a.clock_in 有值（有打卡）且 actual_start 有值
    -- 跨午夜的班暫不處理（minutes 算出負數會被 GREATEST(0) 收掉，不會誤報但會漏報）
    diff_calc AS (
      SELECT
        d.day,
        ws.date AS ws_date,
        ws.shift AS ws_shift,
        ws.actual_start,
        ws.actual_end,
        ws.actual_hours AS ws_actual_hours,
        s.date AS s_date,
        s.shift AS s_shift,
        a.clock_in,
        a.clock_out,
        a.total_hours,
        CASE
          WHEN ws.date IS NOT NULL
           AND ws.actual_start IS NOT NULL
           AND a.clock_in IS NOT NULL
          THEN GREATEST(
                 0,
                 ROUND(EXTRACT(EPOCH FROM (a.clock_in::TIME - ws.actual_start)) / 60)::INT
               )
          ELSE 0
        END AS computed_late_minutes
      FROM days d
      LEFT JOIN sched s        ON s.date = d.day
      LEFT JOIN work_sched ws  ON ws.date = d.day
      LEFT JOIN att a          ON a.date = d.day
      WHERE NOT EXISTS (SELECT 1 FROM covered c WHERE c.d = d.day)
    )
  SELECT
    dc.day,
    CASE
      WHEN dc.ws_date IS NOT NULL AND dc.clock_in IS NULL THEN 'MISSING'
      WHEN dc.ws_date IS NULL AND dc.s_date IS NULL AND dc.clock_in IS NOT NULL THEN 'UNSCHEDULED'
      WHEN dc.ws_date IS NOT NULL AND dc.total_hours > dc.ws_actual_hours + 0.5 THEN 'OVERWORK'
      WHEN dc.ws_date IS NOT NULL AND dc.total_hours < dc.ws_actual_hours - 0.5 AND dc.total_hours > 0 THEN 'UNDERTIME'
      WHEN dc.ws_date IS NOT NULL AND dc.computed_late_minutes > v_late_tolerance THEN 'LATE'
      ELSE NULL
    END AS diff_type,
    COALESCE(dc.ws_shift, dc.s_shift)::TEXT,
    LEFT(dc.actual_start::TEXT, 5),
    LEFT(dc.actual_end::TEXT, 5),
    dc.ws_actual_hours,
    dc.clock_in::TEXT,
    dc.clock_out::TEXT,
    dc.total_hours,
    CASE
      WHEN dc.ws_date IS NOT NULL AND dc.computed_late_minutes > v_late_tolerance THEN dc.computed_late_minutes::NUMERIC
      WHEN dc.ws_date IS NOT NULL AND dc.total_hours > 0 THEN ROUND((dc.total_hours - dc.ws_actual_hours)::NUMERIC, 1)
      ELSE 0
    END AS diff_value,
    CASE
      WHEN dc.ws_date IS NOT NULL AND dc.clock_in IS NULL THEN
        format('%s 排班 %s 但未打卡', to_char(dc.day, 'MM/DD'), COALESCE(dc.ws_shift, '?'))
      WHEN dc.ws_date IS NULL AND dc.s_date IS NULL AND dc.clock_in IS NOT NULL THEN
        format('%s 未排班但有打卡 %s-%s', to_char(dc.day, 'MM/DD'), dc.clock_in, COALESCE(dc.clock_out::TEXT, '尚未下班'))
      WHEN dc.ws_date IS NOT NULL AND dc.total_hours > dc.ws_actual_hours + 0.5 THEN
        format('%s 多上 %sh (排班 %sh / 實際 %sh)', to_char(dc.day, 'MM/DD'),
               ROUND((dc.total_hours - dc.ws_actual_hours)::NUMERIC, 1), dc.ws_actual_hours, dc.total_hours)
      WHEN dc.ws_date IS NOT NULL AND dc.total_hours < dc.ws_actual_hours - 0.5 AND dc.total_hours > 0 THEN
        format('%s 少上 %sh (排班 %sh / 實際 %sh)', to_char(dc.day, 'MM/DD'),
               ROUND((dc.ws_actual_hours - dc.total_hours)::NUMERIC, 1), dc.ws_actual_hours, dc.total_hours)
      WHEN dc.ws_date IS NOT NULL AND dc.computed_late_minutes > v_late_tolerance THEN
        format('%s 遲到 %s 分鐘', to_char(dc.day, 'MM/DD'), dc.computed_late_minutes)
      ELSE ''
    END AS message
  FROM diff_calc dc
  WHERE (
    (dc.ws_date IS NOT NULL AND dc.clock_in IS NULL) OR
    (dc.ws_date IS NULL AND dc.s_date IS NULL AND dc.clock_in IS NOT NULL) OR
    (dc.ws_date IS NOT NULL AND dc.total_hours > dc.ws_actual_hours + 0.5) OR
    (dc.ws_date IS NOT NULL AND dc.total_hours < dc.ws_actual_hours - 0.5 AND dc.total_hours > 0) OR
    (dc.ws_date IS NOT NULL AND dc.computed_late_minutes > v_late_tolerance)
  )
  ORDER BY dc.day;
END $$;

GRANT EXECUTE ON FUNCTION public.monthly_attendance_diff(INT, TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.monthly_attendance_diff(INT, TEXT) IS
  '月結排班 vs 打卡差異分析。LATE 偵測改 inline 算（clock_in - actual_start），不依賴 attendance_records.is_late/late_minutes。';

-- ─────────────────────────────────────────────────────────────────
-- 2. commit_attendance_diff_writeback：結算寫回
-- ─────────────────────────────────────────────────────────────────
-- 流程：
--   1. 把該月 (× store filter) 所有 attendance_records 重置 late_minutes=0, is_late=false
--   2. 對每位員工跑 monthly_attendance_diff
--   3. diff_type='LATE' 的 row → UPDATE attendance_records 對應日，寫 late_minutes / is_late
--   4. 回傳統計（processed_employees, late_records_written）
-- 注意：MISSING / OVERWORK / UNDERTIME / UNSCHEDULED 不寫回（無對應欄）
--       未來若要扣全勤獎金抓 MISSING，再另外加 column。
CREATE OR REPLACE FUNCTION public.commit_attendance_diff_writeback(
  p_year_month TEXT,
  p_store_id   INT DEFAULT NULL
)
RETURNS TABLE (
  employees_processed INT,
  late_records_written INT,
  records_reset INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month_start DATE;
  v_month_end   DATE;
  v_emp         RECORD;
  v_diff        RECORD;
  v_emp_count   INT := 0;
  v_late_count  INT := 0;
  v_reset_count INT := 0;
BEGIN
  v_month_start := to_date(p_year_month || '-01', 'YYYY-MM-DD');
  v_month_end   := (v_month_start + INTERVAL '1 month - 1 day')::DATE;

  -- Step 1: 重置該月所有 record 的 late_minutes/is_late
  WITH upd AS (
    UPDATE attendance_records
       SET late_minutes = 0,
           is_late      = false
     WHERE date BETWEEN v_month_start AND v_month_end
       AND (p_store_id IS NULL OR store_id = p_store_id)
       AND (late_minutes <> 0 OR is_late = true)
     RETURNING 1
  )
  SELECT COUNT(*) INTO v_reset_count FROM upd;

  -- Step 2: 對每位員工（× store filter）跑 diff，寫回 LATE
  FOR v_emp IN
    SELECT id FROM employees
     WHERE (p_store_id IS NULL OR store_id = p_store_id)
       AND (resign_date IS NULL OR resign_date >= v_month_start)
       AND (join_date IS NULL OR join_date <= v_month_end)
  LOOP
    v_emp_count := v_emp_count + 1;

    FOR v_diff IN
      SELECT diff_date, diff_value
        FROM public.monthly_attendance_diff(v_emp.id, p_year_month)
       WHERE diff_type = 'LATE'
    LOOP
      UPDATE attendance_records
         SET late_minutes = v_diff.diff_value::INT,
             is_late      = true
       WHERE employee_id = v_emp.id
         AND date        = v_diff.diff_date;
      IF FOUND THEN
        v_late_count := v_late_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_emp_count, v_late_count, v_reset_count;
END $$;

GRANT EXECUTE ON FUNCTION public.commit_attendance_diff_writeback(TEXT, INT) TO authenticated, service_role;

COMMENT ON FUNCTION public.commit_attendance_diff_writeback(TEXT, INT) IS
  '結算寫回：把 monthly_attendance_diff 算出的 LATE 結果寫回 attendance_records.late_minutes / is_late，給批次計薪讀。先重置整月再寫 LATE。';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────
-- 健檢
-- ─────────────────────────────────────────────────────────────────
DO $$
DECLARE v_exists BOOL;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'commit_attendance_diff_writeback'
  ) INTO v_exists;
  RAISE NOTICE 'commit_attendance_diff_writeback function exists: %', v_exists;
  RAISE NOTICE 'monthly_attendance_diff: LATE 偵測已改 inline (clock_in - actual_start)';
  RAISE NOTICE '下一步：HR 在 /hr/attendance-diff-report 用「結算寫回」按鈕跑寫回，然後批次計薪會讀到正確 late_minutes';
END $$;
