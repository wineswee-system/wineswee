-- 加班申請補起訖時間欄位
-- 原本只有 hours 不知道實際是幾點到幾點，補上 start_time / end_time
BEGIN;

ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time   TIME;

COMMENT ON COLUMN public.overtime_requests.start_time IS '加班起始時間（24h，例 18:00）';
COMMENT ON COLUMN public.overtime_requests.end_time   IS '加班結束時間（24h，例 21:30，可跨日）';

COMMIT;
