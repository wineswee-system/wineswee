-- ════════════════════════════════════════════════════════════
-- HR forms B 類（row.current_step 模式）簽核鏈 LINE 通知 — 全部走 DB trigger
-- 涵蓋 3 張表：
--   resignation_requests        離職申請          (RT 'resignation')
--   personnel_transfer_requests 人事異動申請      (RT 'transfer')
--   leave_of_absence_requests   留職停薪申請      (RT 'loa')
--
-- 對齊 expense_request trigger (20260508110000) 的 pattern
--   - INSERT trigger 推第 0 關 approvers
--   - UPDATE current_step ↑ 推下一關 approvers
--   - UPDATE status='已核准/已駁回' 推申請人結果
--   - opt-out flag: app.skip_chain_notify
--
-- 卡片設計（無 postback 按鈕，因 webhook 還未支援這 3 種 rt 的 postback）：
--   - resignation: header #6b7280 (slate gray) + 📤
--   - transfer:    header #8b5cf6 (purple)     + 🔄
--   - loa:         header #f59e0b (amber)      + ⏸
--   - footer 只有 LIFF 詳情按鈕 (/approve?type=<rt>&id=X)
--   - 之後 webhook 加 postback 支援後，可以擴充加按鈕
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 通用 helper：推 HR chain flex 卡（同色票/同 layout） ═══
-- 各表自己組 v_extra_rows 跟 v_reason_block，呼 _push_hr_chain_flex 套外殼
CREATE OR REPLACE FUNCTION public._push_hr_chain_flex(
  p_line_user_id text,
  p_liff_id      text,
  p_rt           text,        -- 'resignation' | 'transfer' | 'loa'
  p_id           int,
  p_applicant    text,
  p_dept         text,
  p_event        text,        -- 'step_assigned' | 'request_approved' | 'request_rejected'
  p_extra_rows   jsonb,       -- [ box rows ] 已組好的 jsonb array
  p_reason_block jsonb        -- separator + box，可為 '[]'::jsonb
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

  -- ── palette by rt ──
  CASE p_rt
    WHEN 'resignation' THEN
      v_header_color := '#6b7280'; v_subtitle := '#E5E7EB'; v_emoji := '📤'; v_label := '離職申請';
    WHEN 'transfer' THEN
      v_header_color := '#8b5cf6'; v_subtitle := '#E9D5FF'; v_emoji := '🔄'; v_label := '異動申請';
    WHEN 'loa' THEN
      v_header_color := '#f59e0b'; v_subtitle := '#FDE68A'; v_emoji := '⏸';   v_label := '留職停薪';
    ELSE
      v_header_color := '#4A4A4A'; v_subtitle := '#CCCCCC'; v_emoji := '📋'; v_label := COALESCE(p_rt, '簽核');
  END CASE;

  -- ── status chip + alt text by event ──
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
      jsonb_build_object('type','text','text', '#' || p_id,
        'color', v_subtitle, 'size', 'xs', 'margin', 'xs')
    )
  );

  -- ── body 申請人 block ──
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

  -- 拼接各表自己的 row + reason
  v_rows := v_rows || COALESCE(p_extra_rows, '[]'::jsonb) || COALESCE(p_reason_block, '[]'::jsonb);

  v_body := jsonb_build_object(
    'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '16px',
    'contents', v_rows
  );

  -- ── footer：只有 LIFF 詳情按鈕（B 類目前 webhook 沒支援 postback 給這 3 種 rt） ──
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

GRANT EXECUTE ON FUNCTION public._push_hr_chain_flex(text, text, text, int, text, text, text, jsonb, jsonb)
  TO authenticated, service_role;


-- ═══ 2. 各表 row → flex helper ═══

-- ── 2.1 resignation ──
CREATE OR REPLACE FUNCTION public._push_resignation_flex(
  p_line_user_id text, p_liff_id text, p_id int, p_event text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row resignation_requests;
  v_emp_name text; v_dept text;
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';
  v_color_danger CONSTANT text := '#dc2626';
  v_extra jsonb := '[]'::jsonb;
  v_reason jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_row FROM resignation_requests WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  SELECT e.name, COALESCE(d.name, e.dept) INTO v_emp_name, v_dept
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id
   WHERE e.id = v_row.employee_id;

  -- 預計離職日期
  v_extra := v_extra || jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','預計離職','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', to_char(v_row.planned_resign_date, 'YYYY-MM-DD'),
          'size','sm','color',v_text_body,'weight','bold','flex',5)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','離職原因','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_row.reason, '—'),
          'size','sm','color',v_text_body,'flex',5,'wrap',true)
      )
    )
  );

  -- 退回原因 / 詳細補充
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
  ELSIF COALESCE(btrim(v_row.reason_detail), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F9FAFB','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 補充說明','size','xxs','color',v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reason_detail,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  PERFORM public._push_hr_chain_flex(
    p_line_user_id, p_liff_id, 'resignation', p_id,
    v_emp_name, v_dept, p_event, v_extra, v_reason
  );
END $$;
GRANT EXECUTE ON FUNCTION public._push_resignation_flex(text, text, int, text) TO authenticated, service_role;


-- ── 2.2 transfer ──
CREATE OR REPLACE FUNCTION public._push_transfer_flex(
  p_line_user_id text, p_liff_id text, p_id int, p_event text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row personnel_transfer_requests;
  v_emp_name text; v_dept text;
  v_old_dept text; v_new_dept text;
  v_old_store text; v_new_store text;
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';
  v_color_danger CONSTANT text := '#dc2626';
  v_extra jsonb := '[]'::jsonb;
  v_reason jsonb := '[]'::jsonb;
  v_change_str text := '';
BEGIN
  SELECT * INTO v_row FROM personnel_transfer_requests WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  SELECT e.name, COALESCE(d.name, e.dept) INTO v_emp_name, v_dept
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id
   WHERE e.id = v_row.employee_id;

  SELECT name INTO v_old_dept FROM departments WHERE id = v_row.old_department_id;
  SELECT name INTO v_new_dept FROM departments WHERE id = v_row.new_department_id;
  SELECT name INTO v_old_store FROM stores      WHERE id = v_row.old_store_id;
  SELECT name INTO v_new_store FROM stores      WHERE id = v_row.new_store_id;

  -- 組「變動摘要」字串
  IF v_old_dept IS DISTINCT FROM v_new_dept AND v_new_dept IS NOT NULL THEN
    v_change_str := COALESCE(v_old_dept, '—') || ' → ' || v_new_dept;
  ELSIF v_old_store IS DISTINCT FROM v_new_store AND v_new_store IS NOT NULL THEN
    v_change_str := COALESCE(v_old_store, '—') || ' → ' || v_new_store;
  ELSIF v_row.old_position IS DISTINCT FROM v_row.new_position AND v_row.new_position IS NOT NULL THEN
    v_change_str := COALESCE(v_row.old_position, '—') || ' → ' || v_row.new_position;
  END IF;

  v_extra := jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','異動類型','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_row.transfer_type, '—'),
          'size','sm','color',v_text_body,'weight','bold','flex',5)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','生效日','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', to_char(v_row.effective_date, 'YYYY-MM-DD'),
          'size','sm','color',v_text_body,'flex',5)
      )
    )
  );

  IF v_change_str <> '' THEN
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','變動','size','sm','color',v_text_label,'flex',2),
          jsonb_build_object('type','text','text', v_change_str,
            'size','sm','color',v_text_body,'flex',5,'wrap',true)
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
          jsonb_build_object('type','text','text','📝 異動原因','size','xxs','color',v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  PERFORM public._push_hr_chain_flex(
    p_line_user_id, p_liff_id, 'transfer', p_id,
    v_emp_name, v_dept, p_event, v_extra, v_reason
  );
END $$;
GRANT EXECUTE ON FUNCTION public._push_transfer_flex(text, text, int, text) TO authenticated, service_role;


-- ── 2.3 loa ──
CREATE OR REPLACE FUNCTION public._push_loa_flex(
  p_line_user_id text, p_liff_id text, p_id int, p_event text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row leave_of_absence_requests;
  v_emp_name text; v_dept text;
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';
  v_color_danger CONSTANT text := '#dc2626';
  v_extra jsonb := '[]'::jsonb;
  v_reason jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_row FROM leave_of_absence_requests WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  SELECT e.name, COALESCE(d.name, e.dept) INTO v_emp_name, v_dept
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id
   WHERE e.id = v_row.employee_id;

  v_extra := jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','留停類型','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_row.reason_type, '—'),
          'size','sm','color',v_text_body,'weight','bold','flex',5)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','期間','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text',
          to_char(v_row.start_date, 'YYYY-MM-DD') || ' ~ ' || to_char(v_row.planned_end_date, 'YYYY-MM-DD'),
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
  ELSIF COALESCE(btrim(v_row.reason_detail), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F9FAFB','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 補充說明','size','xxs','color',v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reason_detail,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  PERFORM public._push_hr_chain_flex(
    p_line_user_id, p_liff_id, 'loa', p_id,
    v_emp_name, v_dept, p_event, v_extra, v_reason
  );
END $$;
GRANT EXECUTE ON FUNCTION public._push_loa_flex(text, text, int, text) TO authenticated, service_role;


-- ═══ 3. 通用 step notify：dispatch 到對應 push helper ═══
CREATE OR REPLACE FUNCTION public._notify_hr_b_step(
  p_table       text,    -- 'resignation' | 'transfer' | 'loa'
  p_id          int,
  p_step_order  int
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_chain_id   int;
  v_emp_id     int;
  v_step       approval_chain_steps;
  v_count      int := 0;
  v_line       record;
BEGIN
  -- 用 dynamic SQL 抓 chain_id + employee_id
  EXECUTE format(
    'SELECT approval_chain_id, employee_id FROM %I WHERE id = $1',
    CASE p_table
      WHEN 'resignation' THEN 'resignation_requests'
      WHEN 'transfer'    THEN 'personnel_transfer_requests'
      WHEN 'loa'         THEN 'leave_of_absence_requests'
    END
  ) INTO v_chain_id, v_emp_id USING p_id;

  IF v_chain_id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_chain_id AND step_order = p_step_order;
  IF v_step.id IS NULL THEN RETURN 0; END IF;

  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
      FROM resolve_chain_step_approvers(v_step.id, v_emp_id) a
      JOIN v_employee_line_resolved v ON v.employee_id = a.emp_id
                                     AND v.line_user_id = a.line_user_id
     WHERE v.line_user_id IS NOT NULL
  LOOP
    -- dispatch by table
    IF p_table = 'resignation' THEN
      PERFORM public._push_resignation_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_table = 'transfer' THEN
      PERFORM public._push_transfer_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    ELSIF p_table = 'loa' THEN
      PERFORM public._push_loa_flex(v_line.line_user_id, v_line.liff_id, p_id, 'step_assigned');
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;
GRANT EXECUTE ON FUNCTION public._notify_hr_b_step(text, int, int) TO authenticated, service_role;


-- ═══ 4. trigger 函式（per table），對應 INSERT + UPDATE ═══

-- ── 4.1 resignation_requests ──
CREATE OR REPLACE FUNCTION public._trg_notify_resignation_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('申請中', '待審') THEN RETURN NEW; END IF;
  IF NEW.approval_chain_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public._notify_hr_b_step('resignation', NEW.id, COALESCE(NEW.current_step, 0));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_resignation_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app_line text; v_app_liff text;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v WHERE v.employee_id = NEW.employee_id
      ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_resignation_flex(v_app_line, v_app_liff, NEW.id, 'request_approved');
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = '已駁回' AND OLD.status IS DISTINCT FROM '已駁回' THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v WHERE v.employee_id = NEW.employee_id
      ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_resignation_flex(v_app_line, v_app_liff, NEW.id, 'request_rejected');
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.current_step > COALESCE(OLD.current_step, 0)
     AND NEW.status IN ('申請中', '待審')
     AND NEW.approval_chain_id IS NOT NULL THEN
    PERFORM public._notify_hr_b_step('resignation', NEW.id, NEW.current_step);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_resignation_inserted ON public.resignation_requests;
CREATE TRIGGER trg_notify_resignation_inserted
  AFTER INSERT ON public.resignation_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_resignation_inserted();

DROP TRIGGER IF EXISTS trg_notify_resignation_updated ON public.resignation_requests;
CREATE TRIGGER trg_notify_resignation_updated
  AFTER UPDATE ON public.resignation_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_resignation_updated();


-- ── 4.2 personnel_transfer_requests ──
CREATE OR REPLACE FUNCTION public._trg_notify_transfer_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('申請中', '待審') THEN RETURN NEW; END IF;
  IF NEW.approval_chain_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public._notify_hr_b_step('transfer', NEW.id, COALESCE(NEW.current_step, 0));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_transfer_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app_line text; v_app_liff text;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v WHERE v.employee_id = NEW.employee_id
      ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_transfer_flex(v_app_line, v_app_liff, NEW.id, 'request_approved');
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = '已駁回' AND OLD.status IS DISTINCT FROM '已駁回' THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v WHERE v.employee_id = NEW.employee_id
      ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_transfer_flex(v_app_line, v_app_liff, NEW.id, 'request_rejected');
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.current_step > COALESCE(OLD.current_step, 0)
     AND NEW.status IN ('申請中', '待審')
     AND NEW.approval_chain_id IS NOT NULL THEN
    PERFORM public._notify_hr_b_step('transfer', NEW.id, NEW.current_step);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_transfer_inserted ON public.personnel_transfer_requests;
CREATE TRIGGER trg_notify_transfer_inserted
  AFTER INSERT ON public.personnel_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_transfer_inserted();

DROP TRIGGER IF EXISTS trg_notify_transfer_updated ON public.personnel_transfer_requests;
CREATE TRIGGER trg_notify_transfer_updated
  AFTER UPDATE ON public.personnel_transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_transfer_updated();


-- ── 4.3 leave_of_absence_requests ──
CREATE OR REPLACE FUNCTION public._trg_notify_loa_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('申請中', '待審') THEN RETURN NEW; END IF;
  IF NEW.approval_chain_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public._notify_hr_b_step('loa', NEW.id, COALESCE(NEW.current_step, 0));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_loa_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app_line text; v_app_liff text;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v WHERE v.employee_id = NEW.employee_id
      ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_loa_flex(v_app_line, v_app_liff, NEW.id, 'request_approved');
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = '已駁回' AND OLD.status IS DISTINCT FROM '已駁回' THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v WHERE v.employee_id = NEW.employee_id
      ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_loa_flex(v_app_line, v_app_liff, NEW.id, 'request_rejected');
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.current_step > COALESCE(OLD.current_step, 0)
     AND NEW.status IN ('申請中', '待審')
     AND NEW.approval_chain_id IS NOT NULL THEN
    PERFORM public._notify_hr_b_step('loa', NEW.id, NEW.current_step);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_loa_inserted ON public.leave_of_absence_requests;
CREATE TRIGGER trg_notify_loa_inserted
  AFTER INSERT ON public.leave_of_absence_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_loa_inserted();

DROP TRIGGER IF EXISTS trg_notify_loa_updated ON public.leave_of_absence_requests;
CREATE TRIGGER trg_notify_loa_updated
  AFTER UPDATE ON public.leave_of_absence_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_loa_updated();


COMMIT;

NOTIFY pgrst, 'reload schema';
