-- ============================================================
-- Quiet-hours notification queue
-- LINE pushes triggered between 20:00–07:59 Taiwan time
-- are stored here and sent at 08:00 Taiwan the next morning.
-- Taiwan = UTC+8  →  quiet window = 12:00–23:59 UTC
--                     morning send = 00:00 UTC (next day)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notification_quiet_queue (
  id           SERIAL PRIMARY KEY,
  line_user_id TEXT          NOT NULL,
  messages     JSONB         NOT NULL,
  queued_at    TIMESTAMPTZ   DEFAULT now(),
  send_after   TIMESTAMPTZ   NOT NULL,
  sent_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notif_quiet_unsent
  ON public.notification_quiet_queue(send_after, sent_at)
  WHERE sent_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_quiet_queue
  TO authenticated, service_role, anon;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.notification_quiet_queue_id_seq
  TO authenticated, service_role, anon;

NOTIFY pgrst, 'reload schema';
