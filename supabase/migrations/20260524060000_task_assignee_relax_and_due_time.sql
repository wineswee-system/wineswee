-- ════════════════════════════════════════════════════════════════════════════
-- 修：assignee_id 仍吃不到 + 通知卡 due_date 沒帶 due_time
-- ----------------------------------------------------------------------------
-- 問題 1：_task_resolve_assignee_id 太嚴格，找不到匹配員工
--   - 強制 status = '在職'，但 live DB 可能是 'active' / NULL / 其他
--   - 字串比對沒處理全形空白 / unicode 變體
-- 問題 2：reassign 通知卡只顯示 due_date 不顯示 due_time
--   - DB tasks 有 due_date DATE + due_time TIME 兩欄
--   - 之前只 to_char(due_date AT TIME ZONE 'Asia/Taipei')
--     date 沒小時資訊，TZ 轉換結果不直觀
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. _task_resolve_assignee_id 放寬條件
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._task_resolve_assignee_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp_id INT;
  v_org_id INT;
  v_name   TEXT;
BEGIN
  IF NEW.assignee IS NULL OR btrim(NEW.assignee) = '' THEN
    NEW.assignee_id := NULL;
    RETURN NEW;
  END IF;

  -- 強化 normalization：全形空白也 trim、規格化
  v_name := regexp_replace(NEW.assignee, '[\s　]+', '', 'g');  -- 移除所有空白/全形空白

  IF TG_OP = 'UPDATE' AND OLD.assignee IS NOT DISTINCT FROM NEW.assignee THEN
    RETURN NEW;
  END IF;

  v_org_id := NEW.organization_id;

  -- 不再強制 status = '在職'（schema drift safe）
  -- 但同 org 同名員工優先 + 在職員工優先
  IF v_org_id IS NOT NULL THEN
    SELECT id INTO v_emp_id FROM employees
     WHERE regexp_replace(name, '[\s　]+', '', 'g') = v_name
       AND organization_id = v_org_id
     ORDER BY (status = '在職') DESC NULLS LAST, id
     LIMIT 1;
  END IF;
  IF v_emp_id IS NULL THEN
    SELECT id INTO v_emp_id FROM employees
     WHERE regexp_replace(name, '[\s　]+', '', 'g') = v_name
     ORDER BY (status = '在職') DESC NULLS LAST, id
     LIMIT 1;
  END IF;

  NEW.assignee_id := v_emp_id;
  RETURN NEW;
END $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 2. _task_notify_on_reassign：combine due_date + due_time
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._task_notify_on_reassign()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_push_url  CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon      CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_line_uid  TEXT;
  v_liff_id   TEXT;
  v_inst_name TEXT;
  v_liff_url  TEXT;
  v_due_label TEXT;
  v_due_time  TIME;
  v_payload   JSONB;
BEGIN
  IF NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id THEN RETURN NEW; END IF;
  IF NEW.assignee_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status <> '進行中' THEN RETURN NEW; END IF;

  SELECT v.line_user_id, v.liff_id
    INTO v_line_uid, v_liff_id
    FROM public.v_employee_line_resolved v
   WHERE v.employee_id = NEW.assignee_id
   ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
   LIMIT 1;
  IF v_line_uid IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(wi.store, wi.template_name) INTO v_inst_name
    FROM public.workflow_instances wi WHERE wi.id = NEW.workflow_instance_id;

  IF v_liff_id IS NOT NULL THEN
    v_liff_url := 'https://liff.line.me/' || v_liff_id
                  || '?to=%2Ftasks%3Ftask%3D' || NEW.id::text;
  END IF;

  -- ★ 用 due_date (DATE) + due_time (TIME) 組出 MM/DD HH24:MI（台灣時間）
  --   due_time NULL 時用 17:00 預設（跟 frontend 對齊）
  IF NEW.due_date IS NOT NULL THEN
    BEGIN
      v_due_time := COALESCE(NEW.due_time, '17:00'::time);
      v_due_label := to_char(NEW.due_date::date, 'MM/DD') || ' ' || to_char(v_due_time, 'HH24:MI');
    EXCEPTION WHEN OTHERS THEN
      -- due_date 可能被 schema drift 改成 timestamptz
      v_due_label := to_char(NEW.due_date::timestamptz AT TIME ZONE 'Asia/Taipei', 'MM/DD HH24:MI');
    END;
  ELSE
    v_due_label := '未設定';
  END IF;

  v_payload := jsonb_build_object(
    'to', v_line_uid,
    'messages', jsonb_build_array(jsonb_build_object(
      'type', 'flex',
      'altText', '🔄 任務轉派給你：' || COALESCE(NEW.title, ''),
      'contents', jsonb_build_object(
        'type', 'bubble', 'size', 'kilo',
        'header', jsonb_build_object(
          'type', 'box', 'layout', 'vertical',
          'paddingAll', '14px', 'backgroundColor', '#f97316',
          'contents', CASE WHEN v_inst_name IS NOT NULL THEN
            jsonb_build_array(
              jsonb_build_object('type','text','text','🔄 任務轉派通知','color','#FFFFFF','weight','bold','size','md'),
              jsonb_build_object('type','text','text',v_inst_name,'color','#FFFFFFCC','size','xxs','margin','xs','wrap',true)
            )
            ELSE jsonb_build_array(
              jsonb_build_object('type','text','text','🔄 任務轉派通知','color','#FFFFFF','weight','bold','size','md')
            )
          END
        ),
        'body', jsonb_build_object(
          'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '14px',
          'contents', jsonb_build_array(
            jsonb_build_object('type','text','text','此任務已轉派給你','size','sm','color','#666666'),
            jsonb_build_object('type','text','text',COALESCE(NEW.title,''),'weight','bold','size','md','wrap',true),
            jsonb_build_object('type','text','text','到期：' || v_due_label,'size','xs','color','#666666')
          )
        ),
        'footer', jsonb_build_object(
          'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '14px',
          'contents', CASE WHEN v_liff_url IS NOT NULL THEN
            jsonb_build_array(jsonb_build_object(
              'type','button','style','primary','color','#f97316','height','sm',
              'action', jsonb_build_object('type','uri','label','📋 查看任務','uri',v_liff_url)
            ))
            ELSE '[]'::jsonb
          END
        )
      )
    ))
  );

  PERFORM net.http_post(
    url := v_push_url, body := v_payload, params := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon),
    timeout_milliseconds := 8000
  );
  RETURN NEW;
END $$;


-- ═════════════════════════════════════════════════════════════════════════
-- 3. 一次性：補當前 assignee_id 為 NULL 的舊 task（同樣放寬條件）
-- ═════════════════════════════════════════════════════════════════════════
UPDATE public.tasks t
   SET assignee_id = e.id
  FROM public.employees e
 WHERE t.assignee_id IS NULL
   AND t.assignee IS NOT NULL
   AND btrim(t.assignee) <> ''
   AND regexp_replace(e.name, '[\s　]+', '', 'g')
       = regexp_replace(t.assignee, '[\s　]+', '', 'g')
   AND (
     t.organization_id IS NULL
     OR e.organization_id = t.organization_id
   );

COMMIT;

NOTIFY pgrst, 'reload schema';
