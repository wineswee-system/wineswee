-- 1. message_logs 表沒被建過 → CRM/lineNotify 寫入 404
--    建一個基本 schema 讓寫入不再 404；CRM 行銷功能晚點再擴
-- 2. 強制 PostgREST reload schema cache（之前的 NOTIFY 偶有失效）

CREATE TABLE IF NOT EXISTS public.message_logs (
  id          BIGSERIAL PRIMARY KEY,
  channel     TEXT,                    -- 'line' / 'email' / 'sms'
  direction   TEXT DEFAULT 'outbound', -- 'outbound' / 'inbound'
  recipient   TEXT,                    -- 收件者 (line_user_id / email / phone)
  subject     TEXT,
  body        TEXT,
  status      TEXT DEFAULT 'sent',     -- 'queued' / 'sent' / 'failed' / 'delivered'
  error       TEXT,
  meta        JSONB DEFAULT '{}',
  organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  sent_at     TIMESTAMPTZ DEFAULT now(),
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_logs_recipient_sent ON public.message_logs(recipient, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_logs_org_sent       ON public.message_logs(organization_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_logs_status         ON public.message_logs(status) WHERE status <> 'sent';

ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'message_logs' AND policyname = 'auth_message_logs') THEN
    CREATE POLICY auth_message_logs ON public.message_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
