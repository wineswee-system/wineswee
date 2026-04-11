-- ============================================
-- 排班發布狀態追蹤
-- ============================================

CREATE TABLE IF NOT EXISTS schedule_publish_status (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id bigint NOT NULL,
  month text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  published_by text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(store_id, month)
);

COMMENT ON TABLE schedule_publish_status IS '排班發布狀態（draft=草稿/published=已發布）';

CREATE INDEX IF NOT EXISTS idx_schedule_publish_store_month ON schedule_publish_status(store_id, month);
