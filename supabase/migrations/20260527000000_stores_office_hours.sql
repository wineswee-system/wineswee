-- Add office hours columns to stores table
-- Allows each location to define a standard work schedule used as the
-- default shift for late-detection when no individual schedule exists.

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS has_office_hours              boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS office_hours_start            time               DEFAULT '09:00:00',
  ADD COLUMN IF NOT EXISTS office_hours_end              time               DEFAULT '18:00:00',
  ADD COLUMN IF NOT EXISTS office_hours_break_minutes    integer            DEFAULT 60;

COMMENT ON COLUMN stores.has_office_hours             IS '是否啟用固定辦公時間（作為無排班員工的標準打卡班別）';
COMMENT ON COLUMN stores.office_hours_start           IS '辦公時間開始（HH:MM）';
COMMENT ON COLUMN stores.office_hours_end             IS '辦公時間結束（HH:MM）';
COMMENT ON COLUMN stores.office_hours_break_minutes   IS '午休 / 休息時間（分鐘）';
