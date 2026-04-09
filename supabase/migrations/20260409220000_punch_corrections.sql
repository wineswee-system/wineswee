-- Punch correction requests (打卡補登申請)
CREATE TABLE IF NOT EXISTS punch_corrections (
  id SERIAL PRIMARY KEY,
  employee TEXT NOT NULL,
  date DATE NOT NULL,
  correction_type TEXT NOT NULL DEFAULT 'clock_in', -- clock_in, clock_out
  original_time TIME,
  corrected_time TIME NOT NULL,
  reason TEXT NOT NULL,
  status TEXT DEFAULT '待審核',  -- 待審核, 已核准, 已駁回
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  reject_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE punch_corrections ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'punch_corrections' AND policyname = 'anon_punch_corrections') THEN
    CREATE POLICY anon_punch_corrections ON punch_corrections FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
