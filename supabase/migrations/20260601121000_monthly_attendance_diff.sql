-- ═══════════════════════════════════════════════════════════════
-- 月結打卡核對系統
-- 每月 1 號中午 12:00 自動比對上月「排班 vs 打卡」，找出差異發 LINE 提醒員工
-- 排除已有 leave/overtime/correction/business_trip 申請覆蓋的天
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────
-- 1. 通知記錄表 — 防同月重發
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_diff_notifications (
  id          BIGSERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year_month  TEXT NOT NULL,                  -- 'YYYY-MM'
  diff_count  INT NOT NULL DEFAULT 0,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details     JSONB,                          -- 通知時的差異快照
  UNIQUE (employee_id, year_month)
);
CREATE INDEX IF NOT EXISTS idx_attn_diff_notif_emp ON attendance_diff_notifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_attn_diff_notif_ym ON attendance_diff_notifications(year_month);

-- ──────────────────────────────────────────────
-- 2. 核心 RPC: monthly_attendance_diff
-- ──────────────────────────────────────────────
--   Input: 員工 ID、年月 (YYYY-MM)
--   Output: 該員工該月的所有差異 row（已排除有申請覆蓋的天）
--
--   差異類型：
--     MISSING       有班沒打卡
--     LATE          打卡晚於班表 + 超過 late_tolerance
--     EARLY_LEAVE   下班早於班表結束
--     UNSCHEDULED   沒班但有打卡
--     OVERWORK      打卡時數 > 排班時數 + 0.5h
--     UNDERTIME     打卡時數 < 排班時數 - 0.5h
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION monthly_attendance_diff(
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
  diff_value      NUMERIC,     -- 遲到/早退分鐘 or 時數差(小時)
  message         TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

  -- 邊界：入職前/離職後不算
  IF v_join_date IS NOT NULL AND v_join_date > v_month_end THEN RETURN; END IF;
  IF v_resign_date IS NOT NULL AND v_resign_date < v_month_start THEN RETURN; END IF;

  -- 容許範圍
  SELECT COALESCE(late_tolerance_minutes, 5) INTO v_late_tolerance
  FROM stores WHERE id = v_store_id;
  IF v_late_tolerance IS NULL THEN v_late_tolerance := 5; END IF;

  -- 實際分析的範圍（受入職/離職截斷）
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
             a.clock_in::TEXT,
             a.clock_out::TEXT,
             COALESCE(a.total_hours, 0) AS total_hours,
             COALESCE(a.is_late, false) AS is_late,
             COALESCE(a.late_minutes, 0) AS late_minutes
      FROM attendance_records a
      WHERE a.employee_id = p_employee_id
        AND a.date BETWEEN v_month_start AND v_month_end
    ),
    -- 已覆蓋的天 (申請單)
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
    -- 排好的工作日 (排除休假類)
    work_sched AS (
      SELECT * FROM sched
      WHERE shift IS NOT NULL
        AND shift NOT IN ('休', '補休', '特休', '病', '事', '婚', '喪', '公', '產', '生',
                          '工傷', '陪產', '會議', '未入職', '已離職')
    )
  SELECT
    d.day,
    CASE
      -- 1. 有班但完全沒打卡 → MISSING
      WHEN ws.date IS NOT NULL AND (a.clock_in IS NULL OR a.clock_in = '') THEN 'MISSING'
      -- 2. 沒班但有打卡 → UNSCHEDULED
      WHEN ws.date IS NULL AND s.date IS NULL AND a.clock_in IS NOT NULL AND a.clock_in <> '' THEN 'UNSCHEDULED'
      -- 3. 打卡 > 班表時數 +0.5h → OVERWORK
      WHEN ws.date IS NOT NULL AND a.total_hours > ws.actual_hours + 0.5 THEN 'OVERWORK'
      -- 4. 打卡 < 班表時數 -0.5h → UNDERTIME
      WHEN ws.date IS NOT NULL AND a.total_hours < ws.actual_hours - 0.5 AND a.total_hours > 0 THEN 'UNDERTIME'
      -- 5. 遲到超容許 → LATE
      WHEN ws.date IS NOT NULL AND a.is_late AND a.late_minutes > v_late_tolerance THEN 'LATE'
      ELSE NULL
    END AS diff_type,
    COALESCE(ws.shift, s.shift)::TEXT,
    LEFT(ws.actual_start::TEXT, 5),
    LEFT(ws.actual_end::TEXT, 5),
    ws.actual_hours,
    a.clock_in,
    a.clock_out,
    a.total_hours,
    CASE
      WHEN ws.date IS NOT NULL AND a.is_late AND a.late_minutes > v_late_tolerance THEN a.late_minutes::NUMERIC
      WHEN ws.date IS NOT NULL AND a.total_hours > 0 THEN ROUND((a.total_hours - ws.actual_hours)::NUMERIC, 1)
      ELSE 0
    END AS diff_value,
    CASE
      WHEN ws.date IS NOT NULL AND (a.clock_in IS NULL OR a.clock_in = '') THEN
        format('%s 排班 %s 但未打卡', to_char(d.day, 'MM/DD'), COALESCE(ws.shift, '?'))
      WHEN ws.date IS NULL AND s.date IS NULL AND a.clock_in IS NOT NULL AND a.clock_in <> '' THEN
        format('%s 未排班但有打卡 %s-%s', to_char(d.day, 'MM/DD'), a.clock_in, COALESCE(a.clock_out, '尚未下班'))
      WHEN ws.date IS NOT NULL AND a.total_hours > ws.actual_hours + 0.5 THEN
        format('%s 多上 %sh (排班 %sh / 實際 %sh)', to_char(d.day, 'MM/DD'),
               ROUND((a.total_hours - ws.actual_hours)::NUMERIC, 1), ws.actual_hours, a.total_hours)
      WHEN ws.date IS NOT NULL AND a.total_hours < ws.actual_hours - 0.5 AND a.total_hours > 0 THEN
        format('%s 少上 %sh (排班 %sh / 實際 %sh)', to_char(d.day, 'MM/DD'),
               ROUND((ws.actual_hours - a.total_hours)::NUMERIC, 1), ws.actual_hours, a.total_hours)
      WHEN ws.date IS NOT NULL AND a.is_late AND a.late_minutes > v_late_tolerance THEN
        format('%s 遲到 %s 分鐘', to_char(d.day, 'MM/DD'), a.late_minutes)
      ELSE ''
    END AS message
  FROM days d
  LEFT JOIN sched s ON s.date = d.day
  LEFT JOIN work_sched ws ON ws.date = d.day
  LEFT JOIN att a ON a.date = d.day
  WHERE NOT EXISTS (SELECT 1 FROM covered c WHERE c.d = d.day)  -- 排除已申請的天
    AND (
      -- 至少有差異才回傳
      (ws.date IS NOT NULL AND (a.clock_in IS NULL OR a.clock_in = '')) OR
      (ws.date IS NULL AND s.date IS NULL AND a.clock_in IS NOT NULL AND a.clock_in <> '') OR
      (ws.date IS NOT NULL AND a.total_hours > ws.actual_hours + 0.5) OR
      (ws.date IS NOT NULL AND a.total_hours < ws.actual_hours - 0.5 AND a.total_hours > 0) OR
      (ws.date IS NOT NULL AND a.is_late AND a.late_minutes > v_late_tolerance)
    )
  ORDER BY d.day;
END $$;

GRANT EXECUTE ON FUNCTION monthly_attendance_diff(INT, TEXT) TO anon, authenticated, service_role;

-- ──────────────────────────────────────────────
-- 3. LIFF RPC：員工自己查上月差異（走 line_user_id）
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION liff_get_my_attendance_diff(
  p_line_user_id TEXT,
  p_year_month   TEXT
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id INT;
BEGIN
  SELECT employee_id INTO v_employee_id
  FROM employee_line_accounts
  WHERE line_user_id = p_line_user_id AND is_verified = TRUE
  LIMIT 1;

  IF v_employee_id IS NULL THEN RETURN; END IF;

  RETURN QUERY SELECT * FROM monthly_attendance_diff(v_employee_id, p_year_month);
END $$;

GRANT EXECUTE ON FUNCTION liff_get_my_attendance_diff(TEXT, TEXT) TO anon, authenticated;

-- ──────────────────────────────────────────────
-- 4. Admin RPC：HR 看當月所有員工差異報表
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_attendance_diff_report(
  p_year_month TEXT,
  p_store_id   INT DEFAULT NULL
)
RETURNS TABLE (
  employee_id    INT,
  employee_name  TEXT,
  store_name     TEXT,
  diff_count     BIGINT,
  notified       BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.name,
    s.name,
    (SELECT COUNT(*) FROM monthly_attendance_diff(e.id, p_year_month)
       WHERE diff_type IS NOT NULL) AS diff_count,
    EXISTS(SELECT 1 FROM attendance_diff_notifications n
           WHERE n.employee_id = e.id AND n.year_month = p_year_month) AS notified
  FROM employees e
  LEFT JOIN stores s ON s.id = e.store_id
  WHERE e.status = '在職'
    AND (p_store_id IS NULL OR e.store_id = p_store_id)
  ORDER BY diff_count DESC, e.name;
END $$;

GRANT EXECUTE ON FUNCTION admin_attendance_diff_report(TEXT, INT) TO authenticated, service_role;

-- ──────────────────────────────────────────────
-- 5. pg_cron 排程：每月 1 號中午 12:00 (Asia/Taipei = UTC+8 → UTC 04:00)
-- ──────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'monthly-attendance-diff-notify';
    PERFORM cron.schedule(
      'monthly-attendance-diff-notify',
      '0 4 1 * *',  -- 每月 1 號 UTC 04:00 = Asia/Taipei 12:00
      $cron$
      SELECT net.http_post(
        url     := current_setting('app.supabase_url', true) || '/functions/v1/monthly-attendance-diff-notify',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  END IF;
END $$;

COMMIT;
