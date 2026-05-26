-- ── Overtime Clock-In Support ─────────────────────────────────────────────────
-- Allows employees to flag a clock-in/out as 加班 (overtime) directly from LIFF.
-- When flagged:
--   • Time-window restrictions (tooEarly, late tolerance) are bypassed.
--   • The record is stamped is_overtime=true, status='加班'.
--   • An overtime_requests row is auto-created (status='待審核') and cross-linked.
-- HR then reviews overtime requests in the existing 加班申請 flow.

-- ── attendance_records additions ──────────────────────────────────────────────

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS is_overtime         boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overtime_request_id integer  REFERENCES public.overtime_requests(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.attendance_records.is_overtime
  IS '是否為加班打卡（允許時段外打卡，自動建立加班申請）';
COMMENT ON COLUMN public.attendance_records.overtime_request_id
  IS '系統自動建立的加班申請 ID（is_overtime=true 時設定）';

-- ── overtime_requests additions ───────────────────────────────────────────────

ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS attendance_record_id integer  REFERENCES public.attendance_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source               text     NOT NULL DEFAULT 'manual';
  -- source: 'manual' = 一般 HR 表單, 'clock_in' = 上班打卡申請, 'clock_out' = 下班打卡申請

COMMENT ON COLUMN public.overtime_requests.attendance_record_id
  IS '關聯的打卡紀錄 ID（由 clock-in 邊緣函式自動建立時填入）';
COMMENT ON COLUMN public.overtime_requests.source
  IS '申請來源：manual | clock_in | clock_out';

CREATE INDEX IF NOT EXISTS idx_overtime_attendance_record
  ON public.overtime_requests(attendance_record_id);
