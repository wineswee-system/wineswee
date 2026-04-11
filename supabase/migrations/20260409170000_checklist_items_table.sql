-- ── Checklist Items (查核清單項目，屬於 checklists) ──
CREATE TABLE IF NOT EXISTS checklist_items (
  id SERIAL PRIMARY KEY,
  checklist_id INT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  checked BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'checklist_items' AND policyname = 'anon_checklist_items') THEN
    CREATE POLICY anon_checklist_items ON checklist_items FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
