-- ════════════════════════════════════════════════════════════
-- HR forms A 類（workflow_instance + tasks 模式）簽核鏈 LINE 通知
--
-- 涵蓋 5 張表：leave_requests / overtime_requests / business_trips /
--               clock_corrections / expenses (費用報銷)
-- 共通點：所有 chain 進度都掛在 tasks (workflow_instance_id NOT NULL,
--          status='待簽核')，由 createApprovalWorkflow JS 函式建立。
--
-- 設計：
--   - fire on tasks 表（不是各 HR 表）
--   - AFTER INSERT tasks WHERE workflow_instance_id IS NOT NULL
--                              AND status='待簽核'
--                              AND step_order=1 (第一關才推，其他關等 advance 才被指派)
--   - AFTER UPDATE OF assignee_id tasks WHERE 同上條件 → 推下一關 assignee
--   - 跟 trg_task_enqueue_started_notify (fire on status='進行中') 不衝突
--   - 跟 task_chain_unified (fire on task_confirmations) 不衝突
--
-- 卡片設計：
--   - 從 workflow_instances.template_name 推 rt（leave/overtime/trip/expense/correction）
--   - 對應 colors.ts 的 REQUEST_TYPE_COLORS palette
--   - body：申請人 + 步驟名 + due_date
--   - footer：LIFF /approve?type=<rt>&id=<workflow_instance_id> 詳情按鈕
--   - 之後 webhook 對 instance_id 加 postback 支援後可擴充
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. helper：推 workflow task flex 卡 ═══
CREATE OR REPLACE FUNCTION public._push_workflow_task_flex(
  p_line_user_id text,
  p_liff_id      text,
  p_task_id      int,
  p_event        text     -- 'step_assigned' | 'task_approved' | 'task_rejected'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_push_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon       CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';

  v_text_white   CONSTANT text := '#FFFFFF';
  v_text_white_muted CONSTANT text := '#FFFFFFAA';
  v_text_title   CONSTANT text := '#111827';
  v_text_secondary CONSTANT text := '#666666';
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';

  v_task         tasks;
  v_inst         workflow_instances;
  v_emp          employees;
  v_dept         text;

  v_rt           text;
  v_header_color text;
  v_subtitle     text;
  v_emoji        text;
  v_label        text;
  v_status_chip  text;
  v_alt_text     text;
  v_due_label    text;
  v_liff_url     text;

  v_payload      jsonb;
  v_rows         jsonb;
  v_applicant_inner jsonb;
  v_footer_buttons jsonb := '[]'::jsonb;
  v_header       jsonb;
  v_body         jsonb;
  v_footer       jsonb;
BEGIN
  IF p_line_user_id IS NULL OR p_line_user_id = '' THEN RETURN; END IF;

  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF v_task.id IS NULL OR v_task.workflow_instance_id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_inst FROM workflow_instances WHERE id = v_task.workflow_instance_id;
  IF v_inst.id IS NULL THEN RETURN; END IF;

  -- 申請人 (started_by_id 優先，textfallback)
  IF v_inst.started_by_id IS NOT NULL THEN
    SELECT * INTO v_emp FROM employees WHERE id = v_inst.started_by_id;
  ELSIF v_inst.started_by IS NOT NULL THEN
    SELECT * INTO v_emp FROM employees WHERE name = v_inst.started_by LIMIT 1;
  END IF;

  IF v_emp.id IS NOT NULL THEN
    SELECT COALESCE(d.name, v_emp.dept) INTO v_dept
      FROM departments d WHERE d.id = v_emp.department_id;
  END IF;

  -- ── template_name → rt + palette (對齊 colors.ts:REQUEST_TYPE_COLORS) ──
  -- workflowIntegration.js DEFAULT_TEMPLATES 的 template.name
  CASE
    WHEN v_inst.template_name LIKE '%請假%' THEN
      v_rt := 'leave';
      v_header_color := '#10b981'; v_subtitle := '#A7F3D0'; v_emoji := '🏖'; v_label := '請假申請';
    WHEN v_inst.template_name LIKE '%加班%' THEN
      v_rt := 'overtime';
      v_header_color := '#f59e0b'; v_subtitle := '#FDE68A'; v_emoji := '⏰'; v_label := '加班申請';
    WHEN v_inst.template_name LIKE '%出差%' THEN
      v_rt := 'trip';
      v_header_color := '#3b82f6'; v_subtitle := '#BFDBFE'; v_emoji := '✈️'; v_label := '出差申請';
    WHEN v_inst.template_name LIKE '%費用報帳%' OR v_inst.template_name LIKE '%報銷%' THEN
      v_rt := 'expense';
      v_header_color := '#ec4899'; v_subtitle := '#FBCFE8'; v_emoji := '💰'; v_label := '報帳申請';
    WHEN v_inst.template_name LIKE '%補登%' OR v_inst.template_name LIKE '%補卡%' OR v_inst.template_name LIKE '%補打卡%' THEN
      v_rt := 'correction';
      v_header_color := '#8b5cf6'; v_subtitle := '#E9D5FF'; v_emoji := '🔧'; v_label := '補打卡申請';
    ELSE
      v_rt := 'workflow';
      v_header_color := '#8b5cf6'; v_subtitle := '#E9D5FF'; v_emoji := '📋'; v_label := COALESCE(v_inst.template_name, '簽核');
  END CASE;

  -- ── status chip + alt text ──
  IF p_event = 'task_approved' THEN
    v_status_chip := '已通過';
    v_alt_text := v_emoji || ' ' || v_label || '已通過 — ' || COALESCE(v_emp.name, v_inst.started_by, '');
  ELSIF p_event = 'task_rejected' THEN
    v_status_chip := '已退回';
    v_alt_text := v_emoji || ' ' || v_label || '被退回 — ' || COALESCE(v_emp.name, v_inst.started_by, '');
  ELSE
    v_status_chip := '待你審核';
    v_alt_text := v_emoji || ' ' || v_label || ' — ' || COALESCE(v_emp.name, v_inst.started_by, '');
  END IF;

  -- ── due_date 顯示 ──
  IF v_task.due_date IS NOT NULL THEN
    v_due_label := to_char(v_task.due_date, 'YYYY-MM-DD');
  ELSE
    v_due_label := NULL;
  END IF;

  -- ── header ──
  v_header := jsonb_build_object(
    'type', 'box', 'layout', 'vertical', 'paddingAll', '16px',
    'backgroundColor', v_header_color,
    'contents', jsonb_build_array(
      jsonb_build_object(
        'type', 'box', 'layout', 'horizontal',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text', v_emoji || ' ' || v_label,
            'color', v_text_white, 'weight', 'bold', 'size', 'lg', 'flex', 5),
          jsonb_build_object('type','text','text', v_status_chip,
            'color', v_text_white_muted, 'size', 'xs', 'align', 'end', 'gravity', 'center', 'flex', 3)
        )
      ),
      jsonb_build_object('type','text','text', '#' || v_inst.id,
        'color', v_subtitle, 'size', 'xs', 'margin', 'xs')
    )
  );

  -- ── body 申請人 block ──
  v_applicant_inner := jsonb_build_array(
    jsonb_build_object('type','text','text', COALESCE(v_emp.name, v_inst.started_by, ''),
      'weight','bold','size','md','color', v_text_title)
  );
  IF v_dept IS NOT NULL AND v_dept <> '' THEN
    v_applicant_inner := v_applicant_inner || jsonb_build_array(
      jsonb_build_object('type','text','text', v_dept,
        'size','xs','color', v_text_secondary, 'margin','none')
    );
  END IF;

  v_rows := jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','spacing','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','👤','size','lg','flex',0),
        jsonb_build_object('type','box','layout','vertical','flex',7,
          'contents', v_applicant_inner)
      )
    ),
    jsonb_build_object('type','separator','margin','md'),
    -- 步驟名稱
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','關卡','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text',
          '第 ' || COALESCE(v_task.step_order, 1) || ' 關 · ' || COALESCE(v_task.title, '審核'),
          'size','sm','color',v_text_body,'weight','bold','flex',5,'wrap',true)
      )
    )
  );

  IF v_due_label IS NOT NULL THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','期限','size','sm','color',v_text_label,'flex',2),
          jsonb_build_object('type','text','text', v_due_label,
            'size','sm','color',v_text_body,'flex',5)
        )
      )
    );
  END IF;

  -- 店別（如有）
  IF v_inst.store IS NOT NULL AND v_inst.store <> '' THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','店別','size','sm','color',v_text_label,'flex',2),
          jsonb_build_object('type','text','text', v_inst.store,
            'size','sm','color',v_text_body,'flex',5,'wrap',true)
        )
      )
    );
  END IF;

  v_body := jsonb_build_object(
    'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '16px',
    'contents', v_rows
  );

  -- ── footer：LIFF 詳情按鈕（純 LIFF，不放 postback；webhook 端 rt 對應未含 instance 模式） ──
  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
                  || '?to=%2Fapprove%3Ftype%3D' || v_rt || '%26id%3D' || v_inst.id::text;
    v_footer_buttons := jsonb_build_array(
      jsonb_build_object(
        'type','button',
        'action', jsonb_build_object('type','uri',
          'label', CASE p_event WHEN 'step_assigned' THEN '📋 看完整詳情' ELSE '📋 查看詳情' END,
          'uri', v_liff_url),
        'style','primary','color', v_header_color,'height','sm'
      )
    );
  END IF;

  v_footer := jsonb_build_object(
    'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '12px',
    'contents', v_footer_buttons
  );

  v_payload := jsonb_build_object(
    'to', p_line_user_id,
    'messages', jsonb_build_array(
      jsonb_build_object(
        'type', 'flex',
        'altText', v_alt_text,
        'contents', jsonb_build_object(
          'type', 'bubble', 'size', 'kilo',
          'header', v_header,
          'body',   v_body,
          'footer', v_footer
        )
      )
    )
  );

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
END $$;

GRANT EXECUTE ON FUNCTION public._push_workflow_task_flex(text, text, int, text)
  TO authenticated, service_role;


-- ═══ 2. helper：對 task assignee 推 LINE ═══
CREATE OR REPLACE FUNCTION public._notify_workflow_task_assignee(
  p_task_id int,
  p_event   text   -- 'step_assigned' | 'task_approved' | 'task_rejected'
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_task     tasks;
  v_line     text;
  v_liff     text;
BEGIN
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN RETURN 0; END IF;
  IF v_task.assignee_id IS NULL AND (v_task.assignee IS NULL OR v_task.assignee = '') THEN
    RETURN 0;
  END IF;

  -- 解 LINE — 先用 assignee_id（精準），fallback assignee name
  SELECT v.line_user_id, v.liff_id INTO v_line, v_liff
    FROM v_employee_line_resolved v
   WHERE (v_task.assignee_id IS NOT NULL AND v.employee_id = v_task.assignee_id)
      OR (v_task.assignee_id IS NULL AND v.employee_name = v_task.assignee)
   ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
   LIMIT 1;

  IF v_line IS NULL THEN RETURN 0; END IF;

  PERFORM public._push_workflow_task_flex(v_line, v_liff, v_task.id, p_event);
  RETURN 1;
END $$;

GRANT EXECUTE ON FUNCTION public._notify_workflow_task_assignee(int, text) TO authenticated, service_role;


-- ═══ 3. trigger：tasks INSERT/UPDATE OF assignee_id ═══
-- 推 LINE 給 workflow chain 的 task assignee
-- INSERT: 只 fire 第一關（step_order=1）— 其他關建立時 assignee 還沒解（等 advance）
-- UPDATE: fire on assignee_id 變更（advance 後 set 下一關 assignee）
CREATE OR REPLACE FUNCTION public._trg_notify_workflow_task_assigned()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  -- 只處理 workflow_instance 的 task
  IF NEW.workflow_instance_id IS NULL THEN RETURN NEW; END IF;

  -- 只處理 status='待簽核'
  IF NEW.status <> '待簽核' THEN RETURN NEW; END IF;

  -- 沒 assignee_id 跟 assignee → 跳過（advance 還沒解出來）
  IF NEW.assignee_id IS NULL AND (NEW.assignee IS NULL OR NEW.assignee = '') THEN
    RETURN NEW;
  END IF;

  -- INSERT: 只第一關推（其他關後面才會 assign）
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.step_order, 1) <> 1 THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- 只在 assignee 真正改了才推（PostgreSQL OF assignee_id 已 filter，這裡保險）
    IF OLD.assignee_id IS NOT DISTINCT FROM NEW.assignee_id
       AND OLD.assignee IS NOT DISTINCT FROM NEW.assignee THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM public._notify_workflow_task_assignee(NEW.id, 'step_assigned');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_workflow_task_assigned ON public.tasks;
CREATE TRIGGER trg_notify_workflow_task_assigned
  AFTER INSERT OR UPDATE OF assignee_id, assignee ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_workflow_task_assigned();


-- ═══ 4. trigger：workflow_instances 終態（status='已完成' / '已退回'） ═══
-- 通知申請人：流程結束
CREATE OR REPLACE FUNCTION public._trg_notify_workflow_instance_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_app_line text;
  v_app_liff text;
  v_emp_id   int;
  v_first_task_id int;
  v_event    text;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  -- 只在 status 第一次到「已完成 / 已退回」時 fire
  IF NEW.status NOT IN ('已完成', '已退回') THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  v_event := CASE NEW.status WHEN '已完成' THEN 'task_approved' ELSE 'task_rejected' END;

  -- 解申請人 LINE
  v_emp_id := NEW.started_by_id;
  IF v_emp_id IS NULL AND NEW.started_by IS NOT NULL THEN
    SELECT id INTO v_emp_id FROM employees WHERE name = NEW.started_by LIMIT 1;
  END IF;
  IF v_emp_id IS NULL THEN RETURN NEW; END IF;

  SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
    FROM v_employee_line_resolved v
   WHERE v.employee_id = v_emp_id
   ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
   LIMIT 1;
  IF v_app_line IS NULL THEN RETURN NEW; END IF;

  -- 借用任一 task 來組卡（取第一個 task，instance 資訊一致）
  SELECT id INTO v_first_task_id
    FROM tasks WHERE workflow_instance_id = NEW.id
    ORDER BY step_order LIMIT 1;
  IF v_first_task_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public._push_workflow_task_flex(v_app_line, v_app_liff, v_first_task_id, v_event);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_workflow_instance_done ON public.workflow_instances;
CREATE TRIGGER trg_notify_workflow_instance_done
  AFTER UPDATE OF status ON public.workflow_instances
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_workflow_instance_done();


COMMIT;

NOTIFY pgrst, 'reload schema';
