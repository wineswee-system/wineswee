-- ════════════════════════════════════════════════════════════
-- HR A 類簽核 LINE 通知改 fire on 請求表本身（不是 tasks 表）
--
-- Root cause（20260508130000 寫的 trigger 不會 fire）：
--   舊 trigger 設在 tasks INSERT/UPDATE OF assignee_id，但只有 web 端
--   createApprovalWorkflow 才會建 tasks。LIFF 直接 INSERT leave_requests
--   等 5 張表，不建 tasks → 舊 trigger 永遠不 fire → LINE 沒推
--
-- 修法：trigger 搬到 5 個請求表本身（仿 B 類）：
--   - leave_requests        → leave
--   - overtime_requests     → overtime
--   - business_trips        → trip
--   - clock_corrections     → correction
--   - expenses (報帳)        → expense
--
-- 三件事：
--   AFTER INSERT 該表 → 推 LINE 給所有 _resolve_hr_approver_ids approvers
--   AFTER UPDATE status='已核准' → 推申請人「已通過」
--   AFTER UPDATE status='已駁回'/'已退回' → 推申請人「已退回 + 原因」
--
-- 同時 DROP 掉舊 tasks-table A 類 trigger 避免雙推（web 端 createApprovalWorkflow
-- 仍會建 tasks 但 trigger 拔掉，不再從 tasks 推 LINE）
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 0. DROP 舊 A 類 trigger（搬到請求表本身） ═══
DROP TRIGGER IF EXISTS trg_notify_workflow_task_assigned ON public.tasks;
DROP TRIGGER IF EXISTS trg_notify_workflow_instance_done ON public.workflow_instances;
DROP FUNCTION IF EXISTS public._trg_notify_workflow_task_assigned();
DROP FUNCTION IF EXISTS public._trg_notify_workflow_instance_done();
-- 保留 _push_workflow_task_flex / _notify_workflow_task_assignee（其他地方可能用，先留）


-- ═══ 1. 擴充 _push_hr_chain_flex palette 加 5 個 A 類 rt ═══
-- 原本只有 resignation/transfer/loa，加 leave/overtime/trip/correction/expense
CREATE OR REPLACE FUNCTION public._push_hr_chain_flex(
  p_line_user_id text,
  p_liff_id      text,
  p_rt           text,
  p_id           int,
  p_applicant    text,
  p_dept         text,
  p_event        text,
  p_extra_rows   jsonb,
  p_reason_block jsonb
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

  v_header_color text;
  v_subtitle     text;
  v_emoji        text;
  v_label        text;
  v_status_chip  text;
  v_alt_text     text;
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

  -- ── palette by rt（對齊 colors.ts REQUEST_TYPE_COLORS） ──
  CASE p_rt
    -- B 類
    WHEN 'resignation' THEN
      v_header_color := '#6b7280'; v_subtitle := '#E5E7EB'; v_emoji := '📤'; v_label := '離職申請';
    WHEN 'transfer' THEN
      v_header_color := '#8b5cf6'; v_subtitle := '#E9D5FF'; v_emoji := '🔄'; v_label := '異動申請';
    WHEN 'loa' THEN
      v_header_color := '#f59e0b'; v_subtitle := '#FDE68A'; v_emoji := '⏸';   v_label := '留職停薪';
    -- A 類（新加）
    WHEN 'leave' THEN
      v_header_color := '#10b981'; v_subtitle := '#A7F3D0'; v_emoji := '🏖'; v_label := '請假申請';
    WHEN 'overtime' THEN
      v_header_color := '#f59e0b'; v_subtitle := '#FDE68A'; v_emoji := '⏰'; v_label := '加班申請';
    WHEN 'trip' THEN
      v_header_color := '#3b82f6'; v_subtitle := '#BFDBFE'; v_emoji := '✈️'; v_label := '出差申請';
    WHEN 'correction' THEN
      v_header_color := '#8b5cf6'; v_subtitle := '#E9D5FF'; v_emoji := '🔧'; v_label := '補打卡申請';
    WHEN 'expense' THEN
      v_header_color := '#ec4899'; v_subtitle := '#FBCFE8'; v_emoji := '💰'; v_label := '報帳申請';
    ELSE
      v_header_color := '#4A4A4A'; v_subtitle := '#CCCCCC'; v_emoji := '📋'; v_label := COALESCE(p_rt, '簽核');
  END CASE;

  IF p_event = 'request_approved' THEN
    v_status_chip := '已核准';
    v_alt_text := v_emoji || ' ' || v_label || '已通過 — ' || COALESCE(p_applicant, '');
  ELSIF p_event = 'request_rejected' THEN
    v_status_chip := '已退回';
    v_alt_text := v_emoji || ' ' || v_label || '被退回 — ' || COALESCE(p_applicant, '');
  ELSE
    v_status_chip := '待你審核';
    v_alt_text := v_emoji || ' ' || v_label || ' — ' || COALESCE(p_applicant, '');
  END IF;

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
      jsonb_build_object('type','text','text', '#' || p_id,
        'color', v_subtitle, 'size', 'xs', 'margin', 'xs')
    )
  );

  v_applicant_inner := jsonb_build_array(
    jsonb_build_object('type','text','text', COALESCE(p_applicant, ''),
      'weight','bold','size','md','color', v_text_title)
  );
  IF p_dept IS NOT NULL AND p_dept <> '' THEN
    v_applicant_inner := v_applicant_inner || jsonb_build_array(
      jsonb_build_object('type','text','text', p_dept,
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
    jsonb_build_object('type','separator','margin','md')
  );

  v_rows := v_rows || COALESCE(p_extra_rows, '[]'::jsonb) || COALESCE(p_reason_block, '[]'::jsonb);

  v_body := jsonb_build_object(
    'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '16px',
    'contents', v_rows
  );

  -- footer LIFF deeplink
  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
                  || '?to=%2Fapprove%3Ftype%3D' || p_rt || '%26id%3D' || p_id::text;
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


-- ═══ 2. 5 個 push helper（per table，組各自的 row） ═══

CREATE OR REPLACE FUNCTION public._push_leave_flex(
  p_line_user_id text, p_liff_id text, p_id int, p_event text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row leave_requests;
  v_emp_name text; v_dept text;
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';
  v_color_danger CONSTANT text := '#dc2626';
  v_extra jsonb := '[]'::jsonb;
  v_reason jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_row FROM leave_requests WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  -- 申請人 + 部門
  IF v_row.employee_id IS NOT NULL THEN
    SELECT e.name, COALESCE(d.name, e.dept) INTO v_emp_name, v_dept
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.id = v_row.employee_id;
  ELSE
    v_emp_name := v_row.employee;
  END IF;

  v_extra := jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','類型','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_row.type, '—'),
          'size','sm','color',v_text_body,'weight','bold','flex',5)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','期間','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text',
          to_char(v_row.start_date, 'YYYY-MM-DD') ||
          CASE WHEN v_row.end_date IS NOT NULL AND v_row.end_date <> v_row.start_date
               THEN ' ~ ' || to_char(v_row.end_date, 'YYYY-MM-DD') ELSE '' END,
          'size','sm','color',v_text_body,'flex',5,'wrap',true)
      )
    )
  );

  IF v_row.days IS NOT NULL THEN
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','天數','size','sm','color',v_text_label,'flex',2),
          jsonb_build_object('type','text','text', v_row.days || ' 天',
            'size','sm','color',v_text_body,'flex',5)
        )
      )
    );
  END IF;

  IF p_event = 'request_rejected' AND COALESCE(btrim(v_row.reject_reason), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FEF2F2','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','❌ 退回原因','size','xxs','color',v_color_danger,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reject_reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  ELSIF COALESCE(btrim(v_row.reason), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F9FAFB','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 請假原因','size','xxs','color',v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  PERFORM public._push_hr_chain_flex(
    p_line_user_id, p_liff_id, 'leave', p_id,
    v_emp_name, v_dept, p_event, v_extra, v_reason
  );
END $$;


CREATE OR REPLACE FUNCTION public._push_overtime_flex(
  p_line_user_id text, p_liff_id text, p_id int, p_event text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row overtime_requests;
  v_emp_name text; v_dept text;
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';
  v_color_danger CONSTANT text := '#dc2626';
  v_extra jsonb := '[]'::jsonb;
  v_reason jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_row FROM overtime_requests WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  IF v_row.employee_id IS NOT NULL THEN
    SELECT e.name, COALESCE(d.name, e.dept) INTO v_emp_name, v_dept
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.id = v_row.employee_id;
  ELSE
    v_emp_name := v_row.employee;
  END IF;

  v_extra := jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','日期','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', to_char(v_row.date, 'YYYY-MM-DD'),
          'size','sm','color',v_text_body,'weight','bold','flex',5)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','時數','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_row.hours::text, '—') || ' 小時',
          'size','sm','color',v_text_body,'flex',5)
      )
    )
  );

  IF p_event = 'request_rejected' AND COALESCE(btrim(v_row.reject_reason), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FEF2F2','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','❌ 退回原因','size','xxs','color',v_color_danger,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reject_reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  ELSIF COALESCE(btrim(v_row.reason), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F9FAFB','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 加班原因','size','xxs','color',v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  PERFORM public._push_hr_chain_flex(
    p_line_user_id, p_liff_id, 'overtime', p_id,
    v_emp_name, v_dept, p_event, v_extra, v_reason
  );
END $$;


CREATE OR REPLACE FUNCTION public._push_trip_flex(
  p_line_user_id text, p_liff_id text, p_id int, p_event text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row business_trips;
  v_emp_name text; v_dept text;
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';
  v_color_danger CONSTANT text := '#dc2626';
  v_extra jsonb := '[]'::jsonb;
  v_reason jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_row FROM business_trips WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  -- business_trips 沒 employee_id，從 employee TEXT 反查
  v_emp_name := v_row.employee;
  SELECT COALESCE(d.name, e.dept) INTO v_dept
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id
   WHERE e.name = v_row.employee
     AND (e.organization_id = v_row.organization_id OR v_row.organization_id IS NULL)
   LIMIT 1;

  v_extra := jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','地點','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_row.destination, '—'),
          'size','sm','color',v_text_body,'weight','bold','flex',5,'wrap',true)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','期間','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text',
          to_char(v_row.start_date, 'YYYY-MM-DD') ||
          CASE WHEN v_row.end_date IS NOT NULL AND v_row.end_date <> v_row.start_date
               THEN ' ~ ' || to_char(v_row.end_date, 'YYYY-MM-DD') ELSE '' END,
          'size','sm','color',v_text_body,'flex',5,'wrap',true)
      )
    )
  );

  IF p_event = 'request_rejected' AND COALESCE(btrim(v_row.reject_reason), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FEF2F2','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','❌ 退回原因','size','xxs','color',v_color_danger,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reject_reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  ELSIF COALESCE(btrim(v_row.purpose), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F9FAFB','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 出差目的','size','xxs','color',v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.purpose,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  PERFORM public._push_hr_chain_flex(
    p_line_user_id, p_liff_id, 'trip', p_id,
    v_emp_name, v_dept, p_event, v_extra, v_reason
  );
END $$;


CREATE OR REPLACE FUNCTION public._push_correction_flex(
  p_line_user_id text, p_liff_id text, p_id int, p_event text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row clock_corrections;
  v_emp_name text; v_dept text;
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';
  v_color_danger CONSTANT text := '#dc2626';
  v_extra jsonb := '[]'::jsonb;
  v_reason jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_row FROM clock_corrections WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  v_emp_name := v_row.employee;
  SELECT COALESCE(d.name, e.dept) INTO v_dept
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id
   WHERE e.name = v_row.employee
     AND (e.organization_id = v_row.organization_id OR v_row.organization_id IS NULL)
   LIMIT 1;

  v_extra := jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','日期','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', to_char(v_row.date, 'YYYY-MM-DD'),
          'size','sm','color',v_text_body,'weight','bold','flex',5)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','補卡類型','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_row.type, '—'),
          'size','sm','color',v_text_body,'flex',5)
      )
    )
  );

  IF v_row.correction_time IS NOT NULL THEN
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','補卡時間','size','sm','color',v_text_label,'flex',2),
          jsonb_build_object('type','text','text', to_char(v_row.correction_time, 'HH24:MI'),
            'size','sm','color',v_text_body,'flex',5)
        )
      )
    );
  END IF;

  IF p_event = 'request_rejected' AND COALESCE(btrim(v_row.reject_reason), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FEF2F2','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','❌ 退回原因','size','xxs','color',v_color_danger,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reject_reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  ELSIF COALESCE(btrim(v_row.reason), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F9FAFB','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 補卡原因','size','xxs','color',v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  PERFORM public._push_hr_chain_flex(
    p_line_user_id, p_liff_id, 'correction', p_id,
    v_emp_name, v_dept, p_event, v_extra, v_reason
  );
END $$;


CREATE OR REPLACE FUNCTION public._push_expense_report_flex(
  p_line_user_id text, p_liff_id text, p_id int, p_event text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row expenses;
  v_emp_name text; v_dept text;
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';
  v_color_success CONSTANT text := '#16a34a';
  v_color_danger CONSTANT text := '#dc2626';
  v_extra jsonb := '[]'::jsonb;
  v_reason jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_row FROM expenses WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  v_emp_name := v_row.employee;
  SELECT COALESCE(d.name, e.dept) INTO v_dept
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id
   WHERE e.name = v_row.employee
     AND (e.organization_id = v_row.organization_id OR v_row.organization_id IS NULL)
   LIMIT 1;

  v_extra := jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','類別','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_row.category, '—'),
          'size','sm','color',v_text_body,'weight','bold','flex',5)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','金額','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text',
          'NT$ ' || to_char(COALESCE(v_row.amount, 0), 'FM999,999,999,999'),
          'size','sm','weight','bold',
          'color', CASE p_event
                     WHEN 'request_approved' THEN v_color_success
                     WHEN 'request_rejected' THEN v_color_danger
                     ELSE v_text_body END,
          'flex',5)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','日期','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', to_char(v_row.date, 'YYYY-MM-DD'),
          'size','sm','color',v_text_body,'flex',5)
      )
    )
  );

  IF p_event = 'request_rejected' AND COALESCE(btrim(v_row.reject_reason), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FEF2F2','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','❌ 退回原因','size','xxs','color',v_color_danger,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reject_reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  ELSIF COALESCE(btrim(v_row.description), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F9FAFB','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 說明','size','xxs','color',v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.description,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  PERFORM public._push_hr_chain_flex(
    p_line_user_id, p_liff_id, 'expense', p_id,
    v_emp_name, v_dept, p_event, v_extra, v_reason
  );
END $$;


-- ═══ 3. 通用 notify：用 _resolve_hr_approver_ids 找所有 approvers + 推 ═══
-- 對 HR forms A 類「沒 chain step 概念，回的是所有當下能簽的人」
CREATE OR REPLACE FUNCTION public._notify_hr_request_approvers(
  p_rt          text,    -- 'leave' | 'overtime' | 'trip' | 'correction' | 'expense'
  p_id          int,
  p_applicant_id int     -- 用來解 approvers
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_line  record;
BEGIN
  IF p_applicant_id IS NULL THEN RETURN 0; END IF;

  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
      FROM _resolve_hr_approver_ids(p_applicant_id) ap_id
      JOIN v_employee_line_resolved v ON v.employee_id = ap_id
     WHERE v.line_user_id IS NOT NULL
  LOOP
    IF p_rt = 'leave' THEN
      PERFORM public._push_leave_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_rt = 'overtime' THEN
      PERFORM public._push_overtime_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_rt = 'trip' THEN
      PERFORM public._push_trip_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_rt = 'correction' THEN
      PERFORM public._push_correction_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_rt = 'expense' THEN
      PERFORM public._push_expense_report_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;


-- ═══ 4. 通用：推申請人結果 (已核准 / 已退回) ═══
CREATE OR REPLACE FUNCTION public._notify_hr_request_applicant(
  p_rt    text,
  p_id    int,
  p_event text,    -- 'request_approved' | 'request_rejected'
  p_applicant_id int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_line text; v_liff text;
BEGIN
  IF p_applicant_id IS NULL THEN RETURN; END IF;

  SELECT v.line_user_id, v.liff_id INTO v_line, v_liff
    FROM v_employee_line_resolved v
   WHERE v.employee_id = p_applicant_id
   ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
   LIMIT 1;
  IF v_line IS NULL THEN RETURN; END IF;

  IF p_rt = 'leave' THEN
    PERFORM public._push_leave_flex(v_line, v_liff, p_id, p_event);
  ELSIF p_rt = 'overtime' THEN
    PERFORM public._push_overtime_flex(v_line, v_liff, p_id, p_event);
  ELSIF p_rt = 'trip' THEN
    PERFORM public._push_trip_flex(v_line, v_liff, p_id, p_event);
  ELSIF p_rt = 'correction' THEN
    PERFORM public._push_correction_flex(v_line, v_liff, p_id, p_event);
  ELSIF p_rt = 'expense' THEN
    PERFORM public._push_expense_report_flex(v_line, v_liff, p_id, p_event);
  END IF;
END $$;


-- ═══ 5. 5 個 INSERT trigger function ═══
-- 共通 helper：從 row 解 applicant_id（leave/overtime 直接用 employee_id；其他 from name）
CREATE OR REPLACE FUNCTION public._trg_notify_leave_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status <> '待審核' THEN RETURN NEW; END IF;
  PERFORM _notify_hr_request_approvers('leave', NEW.id, NEW.employee_id);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_overtime_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status <> '待審核' THEN RETURN NEW; END IF;
  PERFORM _notify_hr_request_approvers('overtime', NEW.id, NEW.employee_id);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_trip_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp_id int;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status <> '待審核' THEN RETURN NEW; END IF;
  SELECT id INTO v_emp_id FROM employees WHERE name = NEW.employee
    AND (organization_id = NEW.organization_id OR NEW.organization_id IS NULL) LIMIT 1;
  PERFORM _notify_hr_request_approvers('trip', NEW.id, v_emp_id);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_correction_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp_id int;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status <> '待審核' THEN RETURN NEW; END IF;
  SELECT id INTO v_emp_id FROM employees WHERE name = NEW.employee
    AND (organization_id = NEW.organization_id OR NEW.organization_id IS NULL) LIMIT 1;
  PERFORM _notify_hr_request_approvers('correction', NEW.id, v_emp_id);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_expense_report_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp_id int;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status <> '待審核' THEN RETURN NEW; END IF;
  SELECT id INTO v_emp_id FROM employees WHERE name = NEW.employee
    AND (organization_id = NEW.organization_id OR NEW.organization_id IS NULL) LIMIT 1;
  PERFORM _notify_hr_request_approvers('expense', NEW.id, v_emp_id);
  RETURN NEW;
END $$;


-- ═══ 6. 5 個 UPDATE trigger function（status 終態通知申請人） ═══
CREATE OR REPLACE FUNCTION public._trg_notify_leave_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    PERFORM _notify_hr_request_applicant('leave', NEW.id, 'request_approved', NEW.employee_id);
  ELSIF (NEW.status = '已駁回' OR NEW.status = '已退回')
        AND OLD.status NOT IN ('已駁回','已退回') THEN
    PERFORM _notify_hr_request_applicant('leave', NEW.id, 'request_rejected', NEW.employee_id);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_overtime_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    PERFORM _notify_hr_request_applicant('overtime', NEW.id, 'request_approved', NEW.employee_id);
  ELSIF (NEW.status = '已駁回' OR NEW.status = '已退回')
        AND OLD.status NOT IN ('已駁回','已退回') THEN
    PERFORM _notify_hr_request_applicant('overtime', NEW.id, 'request_rejected', NEW.employee_id);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_trip_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp_id int;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  SELECT id INTO v_emp_id FROM employees WHERE name = NEW.employee
    AND (organization_id = NEW.organization_id OR NEW.organization_id IS NULL) LIMIT 1;
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    PERFORM _notify_hr_request_applicant('trip', NEW.id, 'request_approved', v_emp_id);
  ELSIF (NEW.status = '已駁回' OR NEW.status = '已退回')
        AND OLD.status NOT IN ('已駁回','已退回') THEN
    PERFORM _notify_hr_request_applicant('trip', NEW.id, 'request_rejected', v_emp_id);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_correction_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp_id int;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  SELECT id INTO v_emp_id FROM employees WHERE name = NEW.employee
    AND (organization_id = NEW.organization_id OR NEW.organization_id IS NULL) LIMIT 1;
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    PERFORM _notify_hr_request_applicant('correction', NEW.id, 'request_approved', v_emp_id);
  ELSIF (NEW.status = '已駁回' OR NEW.status = '已退回')
        AND OLD.status NOT IN ('已駁回','已退回') THEN
    PERFORM _notify_hr_request_applicant('correction', NEW.id, 'request_rejected', v_emp_id);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_expense_report_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp_id int;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  SELECT id INTO v_emp_id FROM employees WHERE name = NEW.employee
    AND (organization_id = NEW.organization_id OR NEW.organization_id IS NULL) LIMIT 1;
  IF NEW.status = '已核銷' AND OLD.status IS DISTINCT FROM '已核銷' THEN
    PERFORM _notify_hr_request_applicant('expense', NEW.id, 'request_approved', v_emp_id);
  ELSIF (NEW.status = '已駁回' OR NEW.status = '已退回')
        AND OLD.status NOT IN ('已駁回','已退回') THEN
    PERFORM _notify_hr_request_applicant('expense', NEW.id, 'request_rejected', v_emp_id);
  END IF;
  RETURN NEW;
END $$;


-- ═══ 7. 掛 trigger ═══
DROP TRIGGER IF EXISTS trg_notify_leave_inserted ON public.leave_requests;
CREATE TRIGGER trg_notify_leave_inserted AFTER INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_leave_inserted();
DROP TRIGGER IF EXISTS trg_notify_leave_updated ON public.leave_requests;
CREATE TRIGGER trg_notify_leave_updated AFTER UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_leave_updated();

DROP TRIGGER IF EXISTS trg_notify_overtime_inserted ON public.overtime_requests;
CREATE TRIGGER trg_notify_overtime_inserted AFTER INSERT ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_overtime_inserted();
DROP TRIGGER IF EXISTS trg_notify_overtime_updated ON public.overtime_requests;
CREATE TRIGGER trg_notify_overtime_updated AFTER UPDATE ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_overtime_updated();

DROP TRIGGER IF EXISTS trg_notify_trip_inserted ON public.business_trips;
CREATE TRIGGER trg_notify_trip_inserted AFTER INSERT ON public.business_trips
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_trip_inserted();
DROP TRIGGER IF EXISTS trg_notify_trip_updated ON public.business_trips;
CREATE TRIGGER trg_notify_trip_updated AFTER UPDATE ON public.business_trips
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_trip_updated();

DROP TRIGGER IF EXISTS trg_notify_correction_inserted ON public.clock_corrections;
CREATE TRIGGER trg_notify_correction_inserted AFTER INSERT ON public.clock_corrections
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_correction_inserted();
DROP TRIGGER IF EXISTS trg_notify_correction_updated ON public.clock_corrections;
CREATE TRIGGER trg_notify_correction_updated AFTER UPDATE ON public.clock_corrections
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_correction_updated();

DROP TRIGGER IF EXISTS trg_notify_expense_report_inserted ON public.expenses;
CREATE TRIGGER trg_notify_expense_report_inserted AFTER INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_expense_report_inserted();
DROP TRIGGER IF EXISTS trg_notify_expense_report_updated ON public.expenses;
CREATE TRIGGER trg_notify_expense_report_updated AFTER UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_expense_report_updated();


COMMIT;

NOTIFY pgrst, 'reload schema';
