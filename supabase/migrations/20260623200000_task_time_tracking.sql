-- Task time tracking: estimated hours + time log entries
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS estimated_hours numeric(6,2),
  ADD COLUMN IF NOT EXISTS logged_hours    numeric(6,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS task_time_logs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id         bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  logged_by       text,
  hours           numeric(5,2) NOT NULL CHECK (hours > 0),
  logged_date     date NOT NULL DEFAULT CURRENT_DATE,
  note            text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_time_logs_task ON task_time_logs(task_id);

-- Keep tasks.logged_hours in sync with sum of time log entries
CREATE OR REPLACE FUNCTION sync_task_logged_hours()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE tasks
  SET logged_hours = (
    SELECT COALESCE(SUM(hours), 0)
    FROM task_time_logs
    WHERE task_id = COALESCE(NEW.task_id, OLD.task_id)
  )
  WHERE id = COALESCE(NEW.task_id, OLD.task_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_task_logged_hours ON task_time_logs;
CREATE TRIGGER trg_sync_task_logged_hours
AFTER INSERT OR UPDATE OR DELETE ON task_time_logs
FOR EACH ROW EXECUTE FUNCTION sync_task_logged_hours();

ALTER TABLE task_time_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org members manage time logs" ON task_time_logs;
DROP POLICY IF EXISTS "time_logs_org_sel" ON task_time_logs;
DROP POLICY IF EXISTS "time_logs_ins" ON task_time_logs;
DROP POLICY IF EXISTS "time_logs_upd" ON task_time_logs;
DROP POLICY IF EXISTS "time_logs_del" ON task_time_logs;

-- Scope reads to tasks visible in the same org; writes stay open (same pattern as other tables)
CREATE POLICY "time_logs_org_sel" ON task_time_logs FOR SELECT
  USING (org_visible((SELECT organization_id FROM tasks WHERE id = task_time_logs.task_id)));
CREATE POLICY "time_logs_ins" ON task_time_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "time_logs_upd" ON task_time_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "time_logs_del" ON task_time_logs FOR DELETE USING (true);
