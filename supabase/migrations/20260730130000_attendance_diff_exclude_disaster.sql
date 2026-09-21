-- 打卡核對報表:天災停班日免罰(covered 加 disaster_days) — 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════
-- 承 20260730120000:covered 白名單只有請假/加班/補打卡/出差,漏了「天災宣告」→
-- 天災停班日(如颱風)員工沒打卡被誤判「未打卡」(慘案:洪伯嘉 07-10 威耀總部天災#9)。
-- 本版在 covered CTE 加 disaster_days:員工所屬門市(或全公司 store_ids IS NULL)在天災
-- 區間內 → 該日免罰(整支 CREATE OR REPLACE,含 20260730120000 全部修正,idempotent)。
--
-- 【下方為 20260730120000 既有內容,原樣保留】
-- 原本一堆誤判,兩個系統性 bug:
--   Bug1 排休日被當上班日:work_sched 用 shift 文字黑名單判定,但清單只有 '休',
--        漏了 '例假'(167筆)、'休息'(196筆)、'國定假'、'產檢' … → 員工休假沒打卡被判「未打卡」。
--   Bug2 每個真的有上班的日子都變「多上時數」:排班時數讀 schedules.actual_hours 欄,
--        但該欄幾乎全是 0/null(沒在維護)→ 實際工時 6~8h > 排班 0h → 一律誤判 OVERWORK。
-- 修法(資料實測:排休 actual_start 100% 為 null、上班班別 100% 有值;total_hours 是已扣休息的淨時數):
--   Fix1 上班日改用 actual_start/actual_end IS NOT NULL 判定 → 排休/請假別(時間 null)自動排除。
--   Fix2 排班時數改用 _shift_seg_hours(actual_start, actual_end, rest_minutes) 從班別時間算淨工時。
--   Fix3 只比對「今天以前」已完成的日子(未來班/今天進行中的班不算未打卡);多上/少上容忍度 0.5→1.0h。
-- 其餘(行政虛擬辦公班、covered 已請假/加班/補卡/出差、遲到 inline 計算、訊息)完全保留。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.monthly_attendance_diff(p_employee_id integer, p_year_month text)
 RETURNS TABLE(diff_date date, diff_type text, expected_shift text, expected_start text, expected_end text, expected_hours numeric, actual_clock_in text, actual_clock_out text, actual_hours numeric, diff_value numeric, message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_month_start    DATE;
  v_month_end      DATE;
  v_late_tolerance INT;
  v_store_id       INT;
  v_join_date      DATE;
  v_resign_date    DATE;
  v_emp_name       TEXT;
  v_emp_category   TEXT;
  v_is_admin       BOOLEAN := false;
  v_office_start   TIME;
  v_office_end     TIME;
  v_emp_org        INT;
BEGIN
  v_month_start := to_date(p_year_month || '-01', 'YYYY-MM-DD');
  v_month_end   := (v_month_start + INTERVAL '1 month - 1 day')::DATE;

  SELECT name, store_id, join_date, resign_date, organization_id
    INTO v_emp_name, v_store_id, v_join_date, v_resign_date, v_emp_org
  FROM employees WHERE id = p_employee_id;

  IF v_emp_name IS NULL THEN RETURN; END IF;
  IF v_emp_org IS DISTINCT FROM current_employee_org() THEN RETURN; END IF;  -- 跨租戶擋
  IF v_join_date IS NOT NULL AND v_join_date > v_month_end THEN RETURN; END IF;
  IF v_resign_date IS NOT NULL AND v_resign_date < v_month_start THEN RETURN; END IF;

  SELECT COALESCE(late_tolerance_minutes, 5) INTO v_late_tolerance
  FROM stores WHERE id = v_store_id;
  IF v_late_tolerance IS NULL THEN v_late_tolerance := 5; END IF;

  -- 行政(admin)固定辦公時間:沒班表用辦公時間比對,寬限預設30
  SELECT COALESCE(ss.employment_category, '') INTO v_emp_category
    FROM salary_structures ss WHERE ss.employee_id = p_employee_id;
  v_is_admin := (v_emp_category = 'admin');
  IF v_is_admin THEN
    SELECT CASE WHEN st.has_office_hours THEN st.office_hours_start ELSE TIME '09:00' END,
           CASE WHEN st.has_office_hours THEN st.office_hours_end   ELSE TIME '18:00' END,
           COALESCE(st.late_tolerance_minutes, 30)
      INTO v_office_start, v_office_end, v_late_tolerance
    FROM stores st WHERE st.id = v_store_id;
    v_office_start := COALESCE(v_office_start, TIME '09:00');
    v_office_end   := COALESCE(v_office_end,   TIME '18:00');
    v_late_tolerance := COALESCE(v_late_tolerance, 30);
  END IF;

  RETURN QUERY
  WITH
    days AS (
      SELECT d::DATE AS day
      FROM generate_series(
        GREATEST(v_month_start, COALESCE(v_join_date, v_month_start)),
        -- ★ Fix3:只到「今天以前」(未來排班 / 今天進行中的班不算未打卡)
        LEAST(v_month_end, COALESCE(v_resign_date, v_month_end), CURRENT_DATE - 1),
        '1 day'::INTERVAL
      ) d
    ),
    sched AS (
      SELECT s.date, s.shift, s.actual_start, s.actual_end,
             -- ★ Fix2:排班時數從班別時間算淨工時(actual_hours 欄沒維護,幾乎全 0)
             COALESCE(public._shift_seg_hours(s.actual_start, s.actual_end, s.rest_minutes), 0) AS actual_hours
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
      UNION
      -- ★ 天災停班日:該員工所屬門市(或全公司 store_ids IS NULL)宣告的天災區間內,
      --   沒打卡不算未打卡(不論支薪/不支薪都免罰;pay policy 是計薪的事,與出勤核對無關)
      SELECT generate_series(dd.start_at::date, dd.end_at::date, '1 day'::INTERVAL)::DATE AS d
      FROM disaster_days dd
      WHERE dd.organization_id = v_emp_org
        AND (dd.store_ids IS NULL OR v_store_id = ANY(dd.store_ids))
        AND dd.start_at::date <= v_month_end AND dd.end_at::date >= v_month_start
    ),
    work_sched AS (
      -- ★ Fix1:有上班時間(actual_start/end 非 null)才算上班日;排休(休息/例假/休)與請假別時間為 null → 自動排除
      SELECT * FROM sched
      WHERE actual_start IS NOT NULL AND actual_end IS NOT NULL
      UNION ALL
      -- 行政:平日(非國定假)無真排班 → 虛擬辦公班,用辦公時間
      SELECT d.day, '辦公'::text, v_office_start, v_office_end,
             GREATEST(EXTRACT(EPOCH FROM (v_office_end - v_office_start))/3600.0 - 1, 0)
      FROM days d
      WHERE v_is_admin
        AND EXTRACT(DOW FROM d.day) NOT IN (0,6)
        AND NOT EXISTS (SELECT 1 FROM sched sc WHERE sc.date = d.day)
        AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = d.day AND COALESCE(h.is_workday, true) = false)
    ),
    -- ★ inline 算 late_minutes,不靠 attendance_records.is_late ★
    -- 只在 ws.date 存在(有班)且 a.clock_in 有值(有打卡)且 actual_start 有值
    -- 跨午夜的班暫不處理(minutes 算出負數會被 GREATEST(0) 收掉,不會誤報但會漏報)
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
      WHEN dc.ws_date IS NOT NULL AND NOT v_is_admin AND dc.total_hours > dc.ws_actual_hours + 1.0 THEN 'OVERWORK'
      WHEN dc.ws_date IS NOT NULL AND NOT v_is_admin AND dc.total_hours < dc.ws_actual_hours - 1.0 AND dc.total_hours > 0 THEN 'UNDERTIME'
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
      WHEN dc.ws_date IS NOT NULL AND dc.total_hours > dc.ws_actual_hours + 1.0 THEN
        format('%s 多上 %sh (排班 %sh / 實際 %sh)', to_char(dc.day, 'MM/DD'),
               ROUND((dc.total_hours - dc.ws_actual_hours)::NUMERIC, 1), dc.ws_actual_hours, dc.total_hours)
      WHEN dc.ws_date IS NOT NULL AND dc.total_hours < dc.ws_actual_hours - 1.0 AND dc.total_hours > 0 THEN
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
    (dc.ws_date IS NOT NULL AND NOT v_is_admin AND dc.total_hours > dc.ws_actual_hours + 1.0) OR
    (dc.ws_date IS NOT NULL AND NOT v_is_admin AND dc.total_hours < dc.ws_actual_hours - 1.0 AND dc.total_hours > 0) OR
    (dc.ws_date IS NOT NULL AND dc.computed_late_minutes > v_late_tolerance)
  )
  ORDER BY dc.day;
END $function$;

NOTIFY pgrst, 'reload schema';
