-- Employee schedule priority (排班優先級)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS schedule_priority INT DEFAULT 3;
-- 1=最優先, 2=優先, 3=一般, 4=低, 5=最低
-- AI 排班時，優先級高的員工會先被排入熱門時段
