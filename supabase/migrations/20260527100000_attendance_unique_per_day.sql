-- Fix #7: Race condition — add UNIQUE(employee_id, date) so concurrent clock-in
-- requests can't both insert a record.  The edge function's insert (now replacing
-- upsert) returns error code 23505 on conflict, which is surfaced as "今日已打過上班卡".
--
-- Deduplication: keep the row with the highest id per (employee_id, date) pair.
-- Rows without employee_id (legacy text-only records) are left untouched.

DELETE FROM public.attendance_records a
USING  public.attendance_records b
WHERE  a.employee_id IS NOT NULL
  AND  a.employee_id = b.employee_id
  AND  a.date        = b.date
  AND  a.id          < b.id;

-- Drop in case a previous attempt left a partial constraint
ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS att_records_emp_date_uniq;

ALTER TABLE public.attendance_records
  ADD CONSTRAINT att_records_emp_date_uniq
  UNIQUE (employee_id, date);

COMMENT ON CONSTRAINT att_records_emp_date_uniq ON public.attendance_records
  IS 'Prevents duplicate clock-in records (one row per employee per calendar day)';
