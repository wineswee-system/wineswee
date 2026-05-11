-- =============================================
-- 永春門市 2026-04 計薪相關資料盤點
-- 用途：跑批次計薪測試前，確認 DB 已有哪些資料
-- 跑法：Supabase Studio → SQL Editor → 貼上 Run，把每段結果 export 給 Claude
-- =============================================

-- ── 0. 門市 + 7 員工識別 ──
SELECT '=== 0. 門市基本 ===' AS section;
SELECT id, name, organization_id, overtime_step_hours
  FROM stores
 WHERE name ILIKE '%永春%';

SELECT '=== 0b. 7 員工身分證 ===' AS section;
SELECT id, name, store, store_id, organization_id, position, status
  FROM employees
 WHERE name = ANY(ARRAY['陳嘉益','許亦翎','徐宥芯','洪瑛妏','蔡伊真','林思妤','陳姿螢'])
 ORDER BY name;

-- ── 1. 薪資結構 ──
SELECT '=== 1. salary_structures ===' AS section;
SELECT e.name, ss.salary_type, ss.base_salary, ss.role_allowance, ss.meal_allowance,
       ss.transport_allowance, ss.attendance_bonus, ss.hourly_rate,
       ss.health_ins_dependents, ss.voluntary_pension_rate, ss.custom_allowances,
       ss.effective_from
  FROM salary_structures ss
  JOIN employees e ON e.id = ss.employee_id
 WHERE e.name = ANY(ARRAY['陳嘉益','許亦翎','徐宥芯','洪瑛妏','蔡伊真','林思妤','陳姿螢'])
 ORDER BY ss.salary_type DESC, e.name;

-- ── 2. 排班 schedules（4/1~4/30）──
SELECT '=== 2a. schedules 筆數 ===' AS section;
SELECT e.name, COUNT(*) AS shifts, COUNT(*) FILTER (WHERE s.shift != '休' AND s.shift IS NOT NULL) AS work_days
  FROM schedules s
  JOIN employees e ON e.name = s.employee
 WHERE s.date >= '2026-04-01' AND s.date <= '2026-04-30'
   AND e.name = ANY(ARRAY['陳嘉益','許亦翎','徐宥芯','洪瑛妏','蔡伊真','林思妤','陳姿螢'])
 GROUP BY e.name
 ORDER BY e.name;

SELECT '=== 2b. schedules 明細（前 100 筆）===' AS section;
SELECT s.employee, s.date, s.shift, s.actual_start, s.actual_end, s.actual_hours
  FROM schedules s
 WHERE s.date >= '2026-04-01' AND s.date <= '2026-04-30'
   AND s.employee = ANY(ARRAY['陳嘉益','許亦翎','徐宥芯','洪瑛妏','蔡伊真','林思妤','陳姿螢'])
 ORDER BY s.employee, s.date
 LIMIT 100;

-- ── 3. 打卡 attendance_records（4/1~4/30）──
SELECT '=== 3a. attendance_records 筆數 ===' AS section;
SELECT e.name,
       COUNT(*) AS total_records,
       COUNT(*) FILTER (WHERE a.is_late = true) AS late_days,
       ROUND(SUM(a.total_hours)::numeric, 1) AS sum_hours,
       SUM(a.late_minutes) AS sum_late_min
  FROM attendance_records a
  JOIN employees e ON e.id = a.employee_id
 WHERE a.date >= '2026-04-01' AND a.date <= '2026-04-30'
   AND e.name = ANY(ARRAY['陳嘉益','許亦翎','徐宥芯','洪瑛妏','蔡伊真','林思妤','陳姿螢'])
 GROUP BY e.name
 ORDER BY e.name;

SELECT '=== 3b. attendance_records 明細（前 100 筆）===' AS section;
SELECT a.employee, a.date, a.clock_in, a.clock_out, a.total_hours,
       a.is_late, a.late_minutes, a.status
  FROM attendance_records a
 WHERE a.date >= '2026-04-01' AND a.date <= '2026-04-30'
   AND a.employee = ANY(ARRAY['陳嘉益','許亦翎','徐宥芯','洪瑛妏','蔡伊真','林思妤','陳姿螢'])
 ORDER BY a.employee, a.date
 LIMIT 100;

-- ── 4. 加班申請 overtime_requests（4/1~4/30 + 已核准）──
SELECT '=== 4a. overtime_requests 統計 ===' AS section;
SELECT e.name,
       COUNT(*) AS ot_records,
       COUNT(*) FILTER (WHERE o.status = '已核准') AS approved,
       ROUND(SUM(CASE WHEN o.status = '已核准' THEN COALESCE(o.ot_hours, o.hours, 0) ELSE 0 END)::numeric, 1) AS sum_hours
  FROM overtime_requests o
  JOIN employees e ON e.id = o.employee_id
 WHERE COALESCE(o.request_date, o.date) >= '2026-04-01'
   AND COALESCE(o.request_date, o.date) <= '2026-04-30'
   AND e.name = ANY(ARRAY['陳嘉益','許亦翎','徐宥芯','洪瑛妏','蔡伊真','林思妤','陳姿螢'])
 GROUP BY e.name
 ORDER BY e.name;

SELECT '=== 4b. overtime_requests 明細 ===' AS section;
SELECT o.employee,
       COALESCE(o.request_date, o.date) AS ot_date,
       EXTRACT(DOW FROM COALESCE(o.request_date, o.date)) AS dow,
       COALESCE(o.ot_hours, o.hours) AS hours,
       o.ot_type,
       o.ot_category,   -- ★ 新欄位（migration 跑完才有值）
       o.status,
       o.reason
  FROM overtime_requests o
 WHERE COALESCE(o.request_date, o.date) >= '2026-04-01'
   AND COALESCE(o.request_date, o.date) <= '2026-04-30'
   AND o.employee = ANY(ARRAY['陳嘉益','許亦翎','徐宥芯','洪瑛妏','蔡伊真','林思妤','陳姿螢'])
 ORDER BY o.employee, ot_date;

-- ── 5. 請假申請 leave_requests（影響扣薪）──
SELECT '=== 5. leave_requests 4 月已核准 ===' AS section;
SELECT l.employee, l.leave_type, l.start_date, l.end_date, l.days, l.status, l.reason
  FROM leave_requests l
 WHERE l.status = '已核准'
   AND l.start_date >= '2026-04-01' AND l.start_date <= '2026-04-30'
   AND l.employee = ANY(ARRAY['陳嘉益','許亦翎','徐宥芯','洪瑛妏','蔡伊真','林思妤','陳姿螢'])
 ORDER BY l.employee, l.start_date;

-- ── 6. 國定假日 holidays（用來判斷 ot_category）──
SELECT '=== 6. holidays 4 月 ===' AS section;
SELECT date, name, type, is_workday, multiplier
  FROM holidays
 WHERE date >= '2026-04-01' AND date <= '2026-04-30'
 ORDER BY date;

-- ── 7. 已存在的薪資紀錄（避免重複計薪）──
SELECT '=== 7. payroll_records 4 月已存 ===' AS section;
SELECT e.name, p.pay_period, p.base_salary, p.overtime_pay, p.net_salary, p.created_at
  FROM payroll_records p
  JOIN employees e ON e.id = p.employee_id
 WHERE p.pay_period = '2026-04'
   AND e.name = ANY(ARRAY['陳嘉益','許亦翎','徐宥芯','洪瑛妏','蔡伊真','林思妤','陳姿螢'])
 ORDER BY e.name;
