-- ============================================================
-- EventBus 所需的兩張表
-- 2026-05-28
--
-- business_events — auditLogger middleware 寫入每一個 event
-- dead_letter_queue — deadLetterQueue middleware 寫入處理失敗的 event
-- dlqMonitor (src/lib/dlqMonitor.js) 每分鐘輪詢這兩張表
-- 表不存在 → 每分鐘 404 噪音
-- ============================================================

BEGIN;

-- ── business_events ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.business_events (
  id              BIGSERIAL PRIMARY KEY,
  event_id        TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  domain          TEXT,
  action          TEXT,
  version         TEXT,
  payload         JSONB,
  metadata        JSONB,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
  organization_id INT         REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_events_timestamp    ON public.business_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_business_events_event_type   ON public.business_events(event_type);
CREATE INDEX IF NOT EXISTS idx_business_events_org_id       ON public.business_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_business_events_event_id     ON public.business_events(event_id);

COMMENT ON TABLE public.business_events IS 'EventBus auditLogger middleware — 每個 event 寫一筆';

-- ── dead_letter_queue ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dead_letter_queue (
  id          BIGSERIAL PRIMARY KEY,
  event_id    TEXT        NOT NULL,
  event_type  TEXT        NOT NULL,
  payload     JSONB,
  metadata    JSONB,
  errors      JSONB,
  retry_count INT         NOT NULL DEFAULT 0,
  status      TEXT        NOT NULL DEFAULT 'pending',  -- pending | resolved | ignored
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dlq_status     ON public.dead_letter_queue(status);
CREATE INDEX IF NOT EXISTS idx_dlq_created_at ON public.dead_letter_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_event_type ON public.dead_letter_queue(event_type);

COMMENT ON TABLE public.dead_letter_queue IS 'EventBus deadLetterQueue middleware — handler 失敗的 event';

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.business_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dead_letter_queue  ENABLE ROW LEVEL SECURITY;

-- 讀：只有 authenticated（管理頁面）
CREATE POLICY "business_events_read_auth" ON public.business_events
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

-- 寫：前端 EventBus 用 authenticated / service_role key 寫入
CREATE POLICY "business_events_insert_auth" ON public.business_events
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY "dlq_read_auth" ON public.dead_letter_queue
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY "dlq_insert_auth" ON public.dead_letter_queue
  FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY "dlq_update_auth" ON public.dead_letter_queue
  FOR UPDATE USING (auth.role() IN ('authenticated', 'service_role'));

COMMIT;
