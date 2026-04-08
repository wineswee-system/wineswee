-- Add GPS + IP columns to attendance_records for clock-in validation
alter table attendance_records add column if not exists clock_in_lat double precision;
alter table attendance_records add column if not exists clock_in_lng double precision;
alter table attendance_records add column if not exists clock_in_ip text;
alter table attendance_records add column if not exists clock_in_location text;
alter table attendance_records add column if not exists clock_out_lat double precision;
alter table attendance_records add column if not exists clock_out_lng double precision;
alter table attendance_records add column if not exists clock_out_ip text;
