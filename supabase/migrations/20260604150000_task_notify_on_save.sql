-- ════════════════════════════════════════════════════════════════════════
-- Fix: fire LINE notification on UPDATE only (not INSERT), and include
-- task_attachments in the flex card body.
--
-- Why:
--   The old trigger fired on AFTER INSERT OR UPDATE OF status.
--   For standalone tasks the frontend uploads attachments AFTER the INSERT,
--   so the notification always fired before attachments were saved → empty.
--
-- New behaviour:
--   • AFTER INSERT  → no notification (frontend calls notifyTaskAssignee
--                     after attachment upload — see Tasks.jsx)
--   • AFTER UPDATE OF status → notification sent, querying task_attachments
--                              so attachments are visible in the card
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._task_enqueue_started_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_push_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon       CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';

  v_line_uid   TEXT;
  v_liff_id    TEXT;
  v_inst_name  TEXT;
  v_liff_url   TEXT;
  v_due_label  TEXT;
  v_due_time   TIME;
  v_due_ts     TIMESTAMPTZ;
  v_is_overdue BOOLEAN := FALSE;
  v_dept       TEXT;
  v_prio_color TEXT;
  v_prio_bg    TEXT;
  v_att_count  INT := 0;
  v_att_row    RECORD;
  v_body_rows  jsonb := '[]'::jsonb;
  v_footer_btns jsonb := '[]'::jsonb;
  v_header_rows jsonb;
  v_payload    jsonb;
BEGIN
  -- ── Only fire on status transitions TO '進行中' via UPDATE ──────────────
  -- INSERT notifications are handled by the frontend (Tasks.jsx) AFTER
  -- attachments are uploaded, so we skip INSERT here entirely.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> '進行中' OR (OLD.status IS NOT DISTINCT FROM '進行中') THEN
    RETURN NEW;
  END IF;

  -- ── Resolve LINE user ───────────────────────────────────────────────────
  SELECT v.line_user_id, v.liff_id
    INTO v_line_uid, v_liff_id
    FROM public.v_employee_line_resolved v
   WHERE (NEW.assignee_id IS NOT NULL AND v.employee_id   = NEW.assignee_id)
      OR (NEW.assignee_id IS NULL     AND v.employee_name = NEW.assignee)
   ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
   LIMIT 1;
  IF v_line_uid IS NULL THEN RETURN NEW; END IF;

  -- ── Workflow instance name ─────────────────────────────────────────────
  SELECT COALESCE(wi.store, wi.template_name) INTO v_inst_name
    FROM public.workflow_instances wi WHERE wi.id = NEW.workflow_instance_id;

  -- ── Department ────────────────────────────────────────────────────────
  IF NEW.assignee_id IS NOT NULL THEN
    SELECT dept INTO v_dept FROM employees WHERE id = NEW.assignee_id;
  END IF;

  -- ── LIFF URL ──────────────────────────────────────────────────────────
  IF v_liff_id IS NOT NULL THEN
    v_liff_url := 'https://liff.line.me/' || v_liff_id
                  || '?to=%2Ftasks%3Ftask%3D' || NEW.id::text;
  END IF;

  -- ── Due date label + overdue flag ─────────────────────────────────────
  IF NEW.due_date IS NOT NULL THEN
    BEGIN
      v_due_time  := COALESCE(NEW.due_time, '17:00'::time);
      v_due_label := to_char(NEW.due_date::date, 'MM/DD') || ' ' || to_char(v_due_time, 'HH24:MI');
      v_due_ts    := (NEW.due_date::date + v_due_time) AT TIME ZONE 'Asia/Taipei';
      v_is_overdue := (v_due_ts < NOW());
    EXCEPTION WHEN OTHERS THEN
      v_due_label  := to_char(NEW.due_date::timestamptz AT TIME ZONE 'Asia/Taipei', 'MM/DD HH24:MI');
      v_is_overdue := (NEW.due_date::timestamptz < NOW());
    END;
  ELSE
    v_due_label := '未設定';
  END IF;

  -- ── Priority colours ──────────────────────────────────────────────────
  v_prio_color := CASE NEW.priority WHEN '高' THEN '#dc2626' WHEN '中' THEN '#f59e0b' WHEN '低' THEN '#10b981' ELSE '#6b7280' END;
  v_prio_bg    := CASE NEW.priority WHEN '高' THEN '#FEF2F2' WHEN '中' THEN '#FEF3C7' WHEN '低' THEN '#D1FAE5' ELSE '#F3F4F6' END;

  -- ── Body: title + priority chip ───────────────────────────────────────
  v_body_rows := jsonb_build_array(
    jsonb_build_object(
      'type', 'box', 'layout', 'horizontal', 'spacing', 'sm', 'alignItems', 'center',
      'contents', jsonb_build_array(
        jsonb_build_object('type', 'text', 'text', COALESCE(NEW.title, ''),
          'weight', 'bold', 'size', 'md', 'wrap', true, 'flex', 1, 'color', '#111827'),
        jsonb_build_object(
          'type', 'box', 'layout', 'vertical', 'flex', 0,
          'backgroundColor', v_prio_bg, 'cornerRadius', '10px',
          'paddingTop', '2px', 'paddingBottom', '2px', 'paddingStart', '8px', 'paddingEnd', '8px',
          'contents', jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', COALESCE(NEW.priority, '中'),
              'size', 'xxs', 'color', v_prio_color, 'weight', 'bold')
          )
        )
      )
    ),
    jsonb_build_object('type', 'text', 'text', 'tk-' || NEW.id::text,
      'size', 'xxs', 'color', '#9CA3AF', 'margin', 'xs')
  );

  -- ── Body: due date ────────────────────────────────────────────────────
  v_body_rows := v_body_rows || jsonb_build_array(
    jsonb_build_object(
      'type', 'box', 'layout', 'horizontal', 'spacing', 'sm', 'margin', 'md',
      'contents', jsonb_build_array(
        jsonb_build_object('type', 'text', 'text', '到期', 'size', 'xs', 'color', '#9CA3AF', 'flex', 2),
        jsonb_build_object('type', 'text', 'text', v_due_label, 'size', 'sm', 'flex', 5, 'wrap', true,
          'color', CASE WHEN v_is_overdue THEN '#dc2626' ELSE '#333333' END,
          'weight', CASE WHEN v_is_overdue THEN 'bold' ELSE 'regular' END)
      )
    )
  );

  -- ── Body: assignee ────────────────────────────────────────────────────
  v_body_rows := v_body_rows || jsonb_build_array(
    jsonb_build_object(
      'type', 'box', 'layout', 'horizontal', 'spacing', 'sm', 'margin', 'sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type', 'text', 'text', '負責人', 'size', 'xs', 'color', '#9CA3AF', 'flex', 2),
        jsonb_build_object('type', 'text', 'text', COALESCE(NEW.assignee, '—'),
          'size', 'sm', 'color', '#333333', 'flex', 5, 'wrap', true)
      )
    )
  );

  -- ── Body: dept / store / role (when present) ──────────────────────────
  IF v_dept IS NOT NULL THEN
    v_body_rows := v_body_rows || jsonb_build_array(
      jsonb_build_object(
        'type', 'box', 'layout', 'horizontal', 'spacing', 'sm', 'margin', 'sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', '部門', 'size', 'xs', 'color', '#9CA3AF', 'flex', 2),
          jsonb_build_object('type', 'text', 'text', v_dept, 'size', 'sm', 'color', '#333333', 'flex', 5, 'wrap', true)
        )
      )
    );
  END IF;

  IF NEW.store IS NOT NULL AND btrim(NEW.store) <> '' THEN
    v_body_rows := v_body_rows || jsonb_build_array(
      jsonb_build_object(
        'type', 'box', 'layout', 'horizontal', 'spacing', 'sm', 'margin', 'sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', '門市', 'size', 'xs', 'color', '#9CA3AF', 'flex', 2),
          jsonb_build_object('type', 'text', 'text', NEW.store, 'size', 'sm', 'color', '#333333', 'flex', 5, 'wrap', true)
        )
      )
    );
  END IF;

  IF NEW.role IS NOT NULL AND btrim(NEW.role) <> '' THEN
    v_body_rows := v_body_rows || jsonb_build_array(
      jsonb_build_object(
        'type', 'box', 'layout', 'horizontal', 'spacing', 'sm', 'margin', 'sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', '角色', 'size', 'xs', 'color', '#9CA3AF', 'flex', 2),
          jsonb_build_object('type', 'text', 'text', NEW.role, 'size', 'sm', 'color', '#333333', 'flex', 5)
        )
      )
    );
  END IF;

  -- ── Body: description / notes ─────────────────────────────────────────
  IF NEW.description IS NOT NULL AND btrim(NEW.description) <> '' THEN
    v_body_rows := v_body_rows || jsonb_build_array(
      jsonb_build_object('type', 'separator', 'margin', 'md'),
      jsonb_build_object('type', 'text', 'text', NEW.description,
        'size', 'sm', 'color', '#444444', 'wrap', true, 'margin', 'md')
    );
  END IF;

  IF NEW.notes IS NOT NULL AND btrim(NEW.notes) <> '' THEN
    v_body_rows := v_body_rows || jsonb_build_array(
      jsonb_build_object('type', 'separator', 'margin', 'md'),
      jsonb_build_object(
        'type', 'box', 'layout', 'vertical', 'paddingAll', '10px',
        'backgroundColor', '#F9FAFB', 'cornerRadius', '6px', 'margin', 'md',
        'contents', jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', '📌 備註', 'size', 'xxs', 'color', '#9CA3AF', 'weight', 'bold'),
          jsonb_build_object('type', 'text', 'text', NEW.notes, 'size', 'sm', 'color', '#333333', 'wrap', true, 'margin', 'xs')
        )
      )
    );
  END IF;

  -- ── Body: attachments (queried NOW — after frontend has saved them) ────
  SELECT COUNT(*) INTO v_att_count FROM task_attachments WHERE task_id = NEW.id;

  IF v_att_count > 0 THEN
    v_body_rows := v_body_rows || jsonb_build_array(
      jsonb_build_object('type', 'separator', 'margin', 'md'),
      jsonb_build_object('type', 'text',
        'text', '📎 附件（' || v_att_count || '）',
        'size', 'sm', 'color', '#444444', 'weight', 'bold', 'margin', 'md')
    );

    FOR v_att_row IN
      SELECT file_name FROM task_attachments WHERE task_id = NEW.id ORDER BY id LIMIT 5
    LOOP
      v_body_rows := v_body_rows || jsonb_build_array(
        jsonb_build_object(
          'type', 'box', 'layout', 'horizontal', 'spacing', 'sm', 'margin', 'sm',
          'contents', jsonb_build_array(
            jsonb_build_object('type', 'text', 'size', 'sm', 'flex', 0,
              'text', CASE
                WHEN v_att_row.file_name ~* '\.(png|jpg|jpeg|gif|webp|svg)$' THEN '🖼️'
                WHEN v_att_row.file_name ~* '\.pdf$'                          THEN '📕'
                WHEN v_att_row.file_name ~* '\.(xlsx|xls|csv)$'               THEN '📊'
                WHEN v_att_row.file_name ~* '\.(docx|doc)$'                   THEN '📝'
                WHEN v_att_row.file_name ~* '\.(zip|rar|7z)$'                 THEN '🗜️'
                ELSE '📄'
              END
            ),
            jsonb_build_object('type', 'text', 'text', COALESCE(v_att_row.file_name, '附件'),
              'size', 'sm', 'color', '#333333', 'wrap', true, 'flex', 1)
          )
        )
      );
    END LOOP;

    IF v_att_count > 5 THEN
      v_body_rows := v_body_rows || jsonb_build_array(
        jsonb_build_object('type', 'text',
          'text', '...共 ' || v_att_count || ' 個附件',
          'size', 'xs', 'color', '#8c8c8c', 'margin', 'xs')
      );
    END IF;
  END IF;

  -- ── Footer buttons ────────────────────────────────────────────────────
  v_footer_btns := jsonb_build_array(
    jsonb_build_object(
      'type', 'button', 'style', 'primary', 'color', '#10b981', 'height', 'sm',
      'action', jsonb_build_object(
        'type', 'postback', 'label', '✅ 回報完成',
        'data', 'action=complete&type=task&id=' || NEW.id::text,
        'displayText', '回報完成任務 #' || NEW.id::text
      )
    )
  );

  IF v_liff_url IS NOT NULL THEN
    v_footer_btns := v_footer_btns || jsonb_build_array(
      jsonb_build_object(
        'type', 'button', 'style', 'secondary', 'height', 'sm',
        'action', jsonb_build_object('type', 'uri', 'label', '📋 查看任務', 'uri', v_liff_url)
      )
    );
  END IF;

  -- ── Header ────────────────────────────────────────────────────────────
  v_header_rows := jsonb_build_array(
    jsonb_build_object(
      'type', 'box', 'layout', 'horizontal', 'alignItems', 'center',
      'contents', CASE WHEN v_is_overdue THEN
        jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', '📋 任務通知',
            'color', '#FFFFFF', 'weight', 'bold', 'size', 'md', 'flex', 1),
          jsonb_build_object(
            'type', 'box', 'layout', 'vertical', 'flex', 0,
            'backgroundColor', '#dc2626', 'cornerRadius', '4px',
            'paddingTop', '3px', 'paddingBottom', '3px', 'paddingStart', '8px', 'paddingEnd', '8px',
            'contents', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', '⚠️ 逾期',
                'color', '#FFFFFF', 'size', 'xxs', 'weight', 'bold')
            )
          )
        )
        ELSE jsonb_build_array(
          jsonb_build_object('type', 'text', 'text', '📋 任務通知',
            'color', '#FFFFFF', 'weight', 'bold', 'size', 'md')
        )
      END
    )
  );
  IF v_inst_name IS NOT NULL THEN
    v_header_rows := v_header_rows || jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', v_inst_name,
        'color', '#FFFFFFCC', 'size', 'xxs', 'margin', 'xs', 'wrap', true)
    );
  END IF;

  -- ── Build & push ──────────────────────────────────────────────────────
  v_payload := jsonb_build_object(
    'to', v_line_uid,
    'messages', jsonb_build_array(jsonb_build_object(
      'type', 'flex',
      'altText', CASE WHEN v_is_overdue THEN '⚠️ [逾期] ' ELSE '' END
                 || '📋 任務通知：' || COALESCE(NEW.title, ''),
      'contents', jsonb_build_object(
        'type', 'bubble', 'size', 'kilo',
        'header', jsonb_build_object(
          'type', 'box', 'layout', 'vertical', 'paddingAll', '14px', 'backgroundColor', '#06b6d4',
          'contents', v_header_rows),
        'body', jsonb_build_object(
          'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '16px',
          'contents', v_body_rows),
        'footer', jsonb_build_object(
          'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '12px',
          'contents', v_footer_btns)
      )
    ))
  );

  PERFORM net.http_post(
    url := v_push_url, body := v_payload, params := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_anon),
    timeout_milliseconds := 8000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[_task_enqueue_started_notify] failed: %', SQLERRM;
  RETURN NEW;
END $$;

-- ── Trigger: UPDATE only — INSERT path handled by frontend ───────────────
DROP TRIGGER IF EXISTS trg_task_enqueue_started_notify ON public.tasks;
CREATE TRIGGER trg_task_enqueue_started_notify
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._task_enqueue_started_notify();

COMMIT;

NOTIFY pgrst, 'reload schema';
