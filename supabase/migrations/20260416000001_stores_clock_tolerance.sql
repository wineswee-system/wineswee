-- Add late tolerance + early clock-in window to stores
alter table stores add column if not exists late_tolerance_minutes int default 5;
alter table stores add column if not exists early_clock_minutes int default 30;
