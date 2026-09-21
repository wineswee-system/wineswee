-- ════════════════════════════════════════════════════════════════════════════
-- 修：task assignee 變更時也要重算 assignee_id + 通知新負責人
-- ----------------------------------------------------------------------------
-- 上一支 migration 20260524040000 的 trigger 有 bug：
--   - 它只在 NEW.assignee_id IS NULL 時跑（避免覆寫）
--   - 但「使用者更新 assignee 為其他人」時，assignee_id 還是舊的（前一個負責人），
--     trigger 就 return；結果 assignee='李四' 但 assignee_id=張三 → 通知通知錯人 / 不通知
--   - 也沒有「指派新人時推 LINE 給他」的邏輯
--
-- 此檔做兩件事：
-- 1. 重寫 _task_resolve_assignee_id：如果 assignee 換了，永遠重新查 assignee_id
-- 2. 新 trigger _task_notify_on_reassign：assignee_id 變了 + status 已是 '進行中'
--    → 推 LINE 給新的人
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. 重寫 _task_resolve_assignee_id
--    · INSERT：assignee 有值就解析 assignee_id（不管原本是否 null）
--    · UPDATE OF assignee：assignee 變了就重算 assignee_id
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._task_resolve_assignee_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp_id INT;
  v_org_id INT;
  v_name   TEXT;
BEGIN
  -- assignee 空就清掉 assignee_id（避免殘留）
  IF NEW.assignee IS NULL OR btrim(NEW.assignee) = '' THEN
    NEW.assignee_id := NULL;
    RETURN NEW;
  END IF;

  v_name := btrim(NEW.assignee);

  -- UPDATE：assignee 沒變就不動（避免不必要的查詢）
  IF TG_OP = 'UPDATE' AND OLD.assignee IS NOT DISTINCT FROM NEW.assignee THEN
    RETURN NEW;
  END IF;

  v_org_id := NEW.organization_id;

  -- 同 org 同名在職員工優先
  IF v_org_id IS NOT NULL THEN
    SELECT id INTO v_emp_id FROM employees
     WHERE name = v_name AND organization_id = v_org_id AND status = '在職'
     ORDER BY id LIMIT 1;
  END IF;
  -- 找不到再放寬
  IF v_emp_id IS NULL THEN
    SELECT id INTO v_emp_id FROM employees
     WHERE name = v_name AND status = '在職'
     ORDER BY id LIMIT 1;
  END IF;

  NEW.assignee_id := v_emp_id;  -- 找不到就 NULL（清空舊的，比保留錯誤好）
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_resolve_assignee_id ON public.tasks;
CREATE TRIGGER trg_task_resolve_assignee_id
  BEFORE INSERT OR UPDATE OF assignee ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._task_resolve_assignee_id();


-- ═════════════════════════════════════════════════════════════════════════
-- 2. 新 trigger：reassign 時推 LINE 給新負責人
--    (只在 status 已是「進行中」時推；待處理的 task 由 status 變化通知)
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
  v_payload   JSONB;
BEGIN
  -- assignee_id 沒變就不推
  IF NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id THEN
    RETURN NEW;
  END IF;
  -- 沒新負責人不推
  IF NEW.assignee_id IS NULL THEN RETURN NEW; END IF;
  -- 任務狀態不是進行中（'待處理' 由 status flip 通知；'已完成' 不需要再推）
  IF NEW.status <> '進行中' THEN RETURN NEW; END IF;

  -- 解 LINE
  SELECT v.line_user_id, v.liff_id
    INTO v_line_uid, v_liff_id
    FROM public.v_employee_line_resolved v
   WHERE v.employee_id = NEW.assignee_id
   ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
   LIMIT 1;
  IF v_line_uid IS NULL THEN RETURN NEW; END IF;

  -- workflow 標籤
  SELECT COALESCE(wi.store, wi.template_name) INTO v_inst_name
    FROM public.workflow_instances wi WHERE wi.id = NEW.workflow_instance_id;

  IF v_liff_id IS NOT NULL THEN
    v_liff_url := 'https://liff.line.me/' || v_liff_id
                  || '?to=%2Ftasks%3Ftask%3D' || NEW.id::text;
  END IF;

  v_due_label := CASE
    WHEN NEW.due_date IS NOT NULL
      THEN to_char(NEW.due_date AT TIME ZONE 'Asia/Taipei', 'MM/DD HH24:MI')
    ELSE '未設定'
  END;

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
    url := v_push_url,
    body := v_payload,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    timeout_milliseconds := 8000
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_notify_on_reassign ON public.tasks;
CREATE TRIGGER trg_task_notify_on_reassign
  AFTER UPDATE OF assignee_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._task_notify_on_reassign();

COMMIT;

NOTIFY pgrst, 'reload schema';
