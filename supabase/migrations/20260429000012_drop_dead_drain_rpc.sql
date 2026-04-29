-- drain_task_started_notifications() was introduced in 20260428050000 and
-- last revised in 20260429000007. It drains task_pending_notifications for
-- task_started events.
--
-- Migration 20260429000008 replaced the trigger with a direct pg_net call
-- to line-push — the trigger no longer writes to the queue, so this RPC
-- will always return 0 rows and is dead code.
--
-- The task_pending_notifications table is intentionally left intact;
-- other notification modes (e.g. task-reminder cron) may still use it.

DROP FUNCTION IF EXISTS public.drain_task_started_notifications();

NOTIFY pgrst, 'reload schema';
