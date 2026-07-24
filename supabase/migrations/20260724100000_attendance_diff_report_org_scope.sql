-- 打卡核對報表/寫回 加租戶(org)過濾 — 2026-07-24
-- ════════════════════════════════════════════════════════════════════════════
-- 症狀:打卡核對報表混入 Demo(展示帳號/org2)員工 → 沒按租戶切乾淨。
-- 3 支皆 SECURITY DEFINER(繞 RLS)且選員工無 org 條件 → 掃全租戶。
--   admin_attendance_diff_report:WHERE 加 e.organization_id=current_employee_org()
--   commit_attendance_diff_writeback:★重要★ Step1 重置 attendance_records + Step2 員工迴圈
--     都加 org 過濾(否則按「結算寫回」會連 Demo 的打卡記錄一起重置=跨租戶污染寫入)
--   monthly_attendance_diff:宣告 v_emp_org、SELECT 補 organization_id、加跨租戶 guard
--     (內部被上兩支呼叫時,員工已在同租戶→guard 通過;防直接帶外租戶 emp_id 偷看)
-- current_employee_org() 靠 auth.uid()→employees.organization_id 解;attendance_records 有 org 欄。
-- 全部 script 產生+diff 核對,其餘 body 逐字一致。
-- ════════════════════════════════════════════════════════════════════════════

-- 1) 報表清單
CREATE OR REPLACE FUNCTION public.admin_attendance_diff_report(p_year_month text, p_store_id integer DEFAULT NULL::integer)
 RETURNS TABLE(employee_id integer, employee_name text, store_name text, diff_count bigint, type_counts jsonb, notified boolean, is_resigned boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store_name TEXT;
  v_mstart DATE := to_date(p_year_month || '-01', 'YYYY-MM-DD');
BEGIN
  IF p_store_id IS NOT NULL THEN
    SELECT name INTO v_store_name FROM public.stores WHERE id = p_store_id;
  END IF;
  RETURN QUERY
  SELECT e.id, e.name, s.name,
    COALESCE(d.total,0)::bigint,
    COALESCE(d.by_type, '{}'::jsonb),
    EXISTS(SELECT 1 FROM public.attendance_diff_notifications n WHERE n.employee_id=e.id AND n.year_month=p_year_month),
    (e.status = '離職')
  FROM public.employees e
  LEFT JOIN public.stores s ON s.id = e.store_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS total, jsonb_object_agg(dt, cnt) AS by_type
    FROM (SELECT diff_type AS dt, COUNT(*) AS cnt
          FROM public.monthly_attendance_diff(e.id, p_year_month)
          WHERE diff_type IS NOT NULL GROUP BY diff_type) g
  ) d ON true
  WHERE (e.status = '在職' OR (e.status = '離職' AND e.resign_date >= v_mstart))
    AND e.organization_id = current_employee_org()
    AND (p_store_id IS NULL OR e.store_id = p_store_id
         OR (v_store_name IS NOT NULL AND v_store_name = ANY(e.additional_stores)))
  ORDER BY COALESCE(d.total,0) DESC, e.name;
END $function$;

-- 2) 結算寫回(讀寫皆框 org)
CREATE OR REPLACE FUNCTION public.commit_attendance_diff_writeback(p_year_month text, p_store_id integer DEFAULT NULL::integer)
 RETURNS TABLE(employees_processed integer, late_records_written integer, records_reset integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
       AND organization_id = current_employee_org()
       AND (late_minutes <> 0 OR is_late = true)
     RETURNING 1
  )
  SELECT COUNT(*) INTO v_reset_count FROM upd;

  -- Step 2: 對每位員工（× store filter）跑 diff，寫回 LATE
  FOR v_emp IN
    SELECT id FROM employees
     WHERE organization_id = current_employee_org()
       AND (p_store_id IS NULL OR store_id = p_store_id)
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
END $function$;

-- 3) 單員工明細(guard)
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
      WHEN dc.ws_date IS NOT NULL AND NOT v_is_admin AND dc.total_hours > dc.ws_actual_hours + 0.5 THEN 'OVERWORK'
      WHEN dc.ws_date IS NOT NULL AND NOT v_is_admin AND dc.total_hours < dc.ws_actual_hours - 0.5 AND dc.total_hours > 0 THEN 'UNDERTIME'
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
    (dc.ws_date IS NOT NULL AND NOT v_is_admin AND dc.total_hours > dc.ws_actual_hours + 0.5) OR
    (dc.ws_date IS NOT NULL AND NOT v_is_admin AND dc.total_hours < dc.ws_actual_hours - 0.5 AND dc.total_hours > 0) OR
    (dc.ws_date IS NOT NULL AND dc.computed_late_minutes > v_late_tolerance)
  )
  ORDER BY dc.day;
END $function$;


NOTIFY pgrst, 'reload schema';
