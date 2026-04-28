-- ============================================================
-- Fix: task_pending_notifications was created without explicit
-- grants. The Edge Function (task-reminder) authenticates with
-- the service_role JWT and queries this table via PostgREST,
-- so it needs SELECT + UPDATE. Without these grants, the query
-- silently returns null and the queue never drains.
--
-- Also reload PostgREST schema cache so the new table is visible.
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_pending_notifications
  TO service_role;

-- service_role uses the sequence too (for any future direct inserts)
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.task_pending_notifications_id_seq
  TO service_role;

NOTIFY pgrst, 'reload schema';
