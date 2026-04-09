-- ── Step Checklist Items (任務內建清單項目) ──
CREATE TABLE IF NOT EXISTS workflow_step_checklist_items (
  id SERIAL PRIMARY KEY,
  step_id INT NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  checked BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE workflow_step_checklist_items ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workflow_step_checklist_items' AND policyname = 'anon_workflow_step_checklist_items') THEN
    CREATE POLICY anon_workflow_step_checklist_items ON workflow_step_checklist_items FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
