-- ============================================================
-- Replace queue/drain with a direct net.http_post to line-push.
--
-- When a task transitions to '進行中' the trigger now:
--   1. Resolves line_user_id + liff_id from v_employee_line_resolved
--      (falls back to employee name when assignee_id is null)
--   2. Builds the flex message payload inline
--   3. Calls line-push directly via pg_net — no queue, no drain hop
--
-- The task_pending_notifications table and drain RPC are left in
-- place (other cron modes still use them) but this trigger no
-- longer writes to the queue.
-- ============================================================

CREATE OR REPLACE FUNCTION public._task_enqueue_started_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_push_url  CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon      CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_line_uid  text;
  v_liff_id   text;
  v_inst_name text;
  v_liff_url  text;
  v_due_label text;
  v_payload   jsonb;
BEGIN
  IF NEW.status = '進行中' AND (OLD.status IS DISTINCT FROM '進行中') THEN

    -- Resolve LINE account — prefer workflow channel, fall back to primary.
    -- When assignee_id is null, match by employee name instead.
    SELECT v.line_user_id, v.liff_id
      INTO v_line_uid, v_liff_id
      FROM public.v_employee_line_resolved v
     WHERE (NEW.assignee_id IS NOT NULL AND v.employee_id   = NEW.assignee_id)
        OR (NEW.assignee_id IS NULL     AND v.employee_name = NEW.assignee)
     ORDER BY
       (v.channel_code = 'workflow') DESC,
       v.is_primary DESC NULLS LAST
     LIMIT 1;

    IF v_line_uid IS NULL THEN
      RETURN NEW;
    END IF;

    -- Workflow instance label (store name preferred over template name)
    SELECT COALESCE(wi.store, wi.template_name)
      INTO v_inst_name
      FROM public.workflow_instances wi
     WHERE wi.id = NEW.workflow_instance_id;

    -- LIFF deep-link (/tasks?task=<id> pre-encoded)
    IF v_liff_id IS NOT NULL THEN
      v_liff_url := 'https://liff.line.me/' || v_liff_id
                    || '?to=%2Ftasks%3Ftask%3D' || NEW.id::text;
    END IF;

    -- Due date formatted for Taipei timezone
    v_due_label := CASE
      WHEN NEW.due_date IS NOT NULL
        THEN to_char(NEW.due_date AT TIME ZONE 'Asia/Taipei', 'MM/DD HH24:MI')
      ELSE '未設定'
    END;

    -- Build flex message payload
    v_payload := jsonb_build_object(
      'to', v_line_uid,
      'messages', jsonb_build_array(
        jsonb_build_object(
          'type', 'flex',
          'altText', '📋 任務通知：' || COALESCE(NEW.title, ''),
          'contents', jsonb_build_object(
            'type', 'bubble', 'size', 'kilo',
            'header', jsonb_build_object(
              'type', 'box', 'layout', 'vertical',
              'paddingAll', '14px', 'backgroundColor', '#06b6d4',
              'contents', CASE
                WHEN v_inst_name IS NOT NULL THEN jsonb_build_array(
                  jsonb_build_object('type','text','text','📋 任務通知','color','#FFFFFF','weight','bold','size','md'),
                  jsonb_build_object('type','text','text',v_inst_name,'color','#FFFFFFCC','size','xxs','margin','xs','wrap',true)
                )
                ELSE jsonb_build_array(
                  jsonb_build_object('type','text','text','📋 任務通知','color','#FFFFFF','weight','bold','size','md')
                )
              END
            ),
            'body', jsonb_build_object(
              'type', 'box', 'layout', 'vertical',
              'spacing', 'sm', 'paddingAll', '14px',
              'contents', jsonb_build_array(
                jsonb_build_object('type','text','text',COALESCE(NEW.title,''),'weight','bold','size','md','wrap',true),
                jsonb_build_object('type','text','text','到期：' || v_due_label,'size','xs','color','#666666'),
                jsonb_build_object('type','text','text','負責人：' || COALESCE(NEW.assignee,''),'size','xs','color','#666666')
              )
            ),
            'footer', jsonb_build_object(
              'type', 'box', 'layout', 'vertical',
              'spacing', 'sm', 'paddingAll', '14px',
              'contents', CASE
                WHEN v_liff_url IS NOT NULL THEN jsonb_build_array(
                  jsonb_build_object(
                    'type','button','style','primary','color','#06b6d4','height','sm',
                    'action', jsonb_build_object('type','uri','label','📋 查看任務','uri',v_liff_url)
                  )
                )
                ELSE '[]'::jsonb
              END
            )
          )
        )
      )
    );

    -- Fire directly — pg_net is async, never blocks the TX
    PERFORM net.http_post(
      url     := v_push_url,
      body    := v_payload,
      params  := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_anon
      ),
      timeout_milliseconds := 8000
    );

  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_enqueue_started_notify ON public.tasks;
CREATE TRIGGER trg_task_enqueue_started_notify
AFTER UPDATE OF status ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public._task_enqueue_started_notify();

NOTIFY pgrst, 'reload schema';
