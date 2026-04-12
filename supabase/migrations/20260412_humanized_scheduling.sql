-- ============================================
-- 人性化排班框架 DB Migration
-- ============================================

-- 1. employees: 新增期望週工時
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS weekly_target_hours numeric DEFAULT 40;

COMMENT ON COLUMN employees.weekly_target_hours IS '期望每週工時（全職預設40h，兼職依個人設定）';

-- 2. schedules: 新增實際上下班時間
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS actual_start time,
  ADD COLUMN IF NOT EXISTS actual_end time,
  ADD COLUMN IF NOT EXISTS actual_hours numeric;

COMMENT ON COLUMN schedules.actual_start IS '實際上班時間（可與班別預設不同）';
COMMENT ON COLUMN schedules.actual_end IS '實際下班時間（可與班別預設不同）';
COMMENT ON COLUMN schedules.actual_hours IS '實際淨工時（扣除休息）';

-- 3. employee_availability: 員工每週可用時段
CREATE TABLE IF NOT EXISTS employee_availability (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee text NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL DEFAULT '11:00',
  end_time time NOT NULL DEFAULT '00:00',
  created_at timestamptz DEFAULT now(),
  UNIQUE(employee, day_of_week)
);

COMMENT ON TABLE employee_availability IS '員工每週可出勤時段（0=日 1=一 ... 6=六）';

-- 4. fatigue_scores: 辛苦度累計
CREATE TABLE IF NOT EXISTS fatigue_scores (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee text NOT NULL,
  month text NOT NULL,
  weekday_morning integer DEFAULT 0,
  weekday_evening integer DEFAULT 0,
  weekend_morning integer DEFAULT 0,
  weekend_evening integer DEFAULT 0,
  holiday_count integer DEFAULT 0,
  total_score integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee, month)
);

COMMENT ON TABLE fatigue_scores IS '員工每月辛苦度累計（用於公平性排班）';

-- 5. Index for performance
CREATE INDEX IF NOT EXISTS idx_employee_availability_employee ON employee_availability(employee);
CREATE INDEX IF NOT EXISTS idx_fatigue_scores_employee_month ON fatigue_scores(employee, month);
CREATE INDEX IF NOT EXISTS idx_schedules_actual ON schedules(date, actual_start, actual_end);
