-- ============================================
-- 時段覆蓋制人力需求
-- ============================================

CREATE TABLE IF NOT EXISTS store_time_slots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id bigint NOT NULL,
  day_type text NOT NULL DEFAULT 'weekday' CHECK (day_type IN ('weekday', 'weekend', 'all')),
  start_time time NOT NULL,
  end_time time NOT NULL,
  required_count integer NOT NULL DEFAULT 1,
  label text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(store_id, day_type, start_time)
);

COMMENT ON TABLE store_time_slots IS '時段人力需求（取代固定班別制）。day_type: weekday=平日, weekend=假日, all=每天';

CREATE INDEX IF NOT EXISTS idx_store_time_slots_store ON store_time_slots(store_id);
