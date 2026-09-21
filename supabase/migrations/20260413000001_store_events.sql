-- Store events (custom calendar markers: 包場, 活動, etc.)
CREATE TABLE IF NOT EXISTS store_events (
  id SERIAL PRIMARY KEY,
  store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  title TEXT NOT NULL,
  color TEXT DEFAULT '#f59e0b',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_store_events_store_date ON store_events(store_id, date);

-- RLS
ALTER TABLE store_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated" ON store_events;
CREATE POLICY "Allow all for authenticated" ON store_events FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon read" ON store_events;
CREATE POLICY "Allow anon read" ON store_events FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon insert" ON store_events;
CREATE POLICY "Allow anon insert" ON store_events FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon update" ON store_events;
CREATE POLICY "Allow anon update" ON store_events FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon delete" ON store_events;
CREATE POLICY "Allow anon delete" ON store_events FOR DELETE TO anon USING (true);
