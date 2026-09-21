-- ════════════════════════════════════════════════════════════
-- M4: shift_swap / off_request 改 DB trigger 推 LINE
--
-- 對齊 20260508170000 (HR A 類)：notification 從 client/RPC return
-- 移到 trigger，避免 client 漏寫 / silent skip。
--
-- shift_swap 5 個轉場：
--   INSERT 待對方同意      → 推 B (target_id)
--   UPDATE → 待主管核准    → 推 store manager
--   UPDATE → 已拒絕        → 推 A (requester_id)（含 peer_reject_reason）
--   UPDATE → 已核准        → 推 A + B
--   UPDATE → 已駁回        → 推 A + B（含 reject_reason）
--   UPDATE → 已取消        → 不推
--
-- off_request 3 個轉場：
--   INSERT 待審核          → 推所有 _resolve_hr_approver_ids approvers
--   UPDATE → 已核准        → 推申請人
--   UPDATE → 已駁回        → 推申請人（含 reject_reason）
--
-- skip flag：app.skip_chain_notify = 'true' 時 trigger 不 fire（同 HR A 類）
-- ════════════════════════════════════════════════════════════

BEGIN;


-- ═══ 1. 擴充 _push_hr_chain_flex palette ═══
-- 加 shift_swap / off_request；保留 B 類 + A 類既有色
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

  -- ── palette by rt ──
  CASE p_rt
    -- B 類
    WHEN 'resignation' THEN
      v_header_color := '#6b7280'; v_subtitle := '#E5E7EB'; v_emoji := '📤'; v_label := '離職申請';
    WHEN 'transfer' THEN
      v_header_color := '#8b5cf6'; v_subtitle := '#E9D5FF'; v_emoji := '🔄'; v_label := '異動申請';
    WHEN 'loa' THEN
      v_header_color := '#f59e0b'; v_subtitle := '#FDE68A'; v_emoji := '⏸';   v_label := '留職停薪';
    -- A 類
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
    -- 排班類（M4 新加）
    WHEN 'shift_swap' THEN
      v_header_color := '#0ea5e9'; v_subtitle := '#BAE6FD'; v_emoji := '🔁'; v_label := '換班申請';
    WHEN 'off_request' THEN
      v_header_color := '#06b6d4'; v_subtitle := '#A5F3FC'; v_emoji := '🌴'; v_label := '希望休申請';
    ELSE
      v_header_color := '#4A4A4A'; v_subtitle := '#CCCCCC'; v_emoji := '📋'; v_label := COALESCE(p_rt, '簽核');
  END CASE;

  -- 狀態 chip + alt_text
  CASE p_event
    WHEN 'request_approved' THEN
      v_status_chip := '已核准';
      v_alt_text := v_emoji || ' ' || v_label || '已通過 — ' || COALESCE(p_applicant, '');
    WHEN 'request_rejected' THEN
      v_status_chip := '已退回';
      v_alt_text := v_emoji || ' ' || v_label || '被退回 — ' || COALESCE(p_applicant, '');
    WHEN 'peer_pending' THEN
      v_status_chip := '待你回覆';
      v_alt_text := v_emoji || ' ' || v_label || '邀請 — ' || COALESCE(p_applicant, '');
    WHEN 'peer_agreed' THEN
      v_status_chip := '對方同意';
      v_alt_text := v_emoji || ' ' || v_label || '對方同意 — ' || COALESCE(p_applicant, '');
    WHEN 'peer_rejected' THEN
      v_status_chip := '對方拒絕';
      v_alt_text := v_emoji || ' ' || v_label || '對方拒絕 — ' || COALESCE(p_applicant, '');
    ELSE
      v_status_chip := '待你審核';
      v_alt_text := v_emoji || ' ' || v_label || ' — ' || COALESCE(p_applicant, '');
  END CASE;

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


-- ═══ 2. _push_shift_swap_flex helper ═══
CREATE OR REPLACE FUNCTION public._push_shift_swap_flex(
  p_line_user_id text, p_liff_id text, p_id int, p_event text, p_recipient_role text DEFAULT 'requester'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row shift_swaps;
  v_show_name text;
  v_show_dept text;
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';
  v_color_danger CONSTANT text := '#dc2626';
  v_extra jsonb := '[]'::jsonb;
  v_reason jsonb := '[]'::jsonb;
  v_reject text;
BEGIN
  SELECT * INTO v_row FROM shift_swaps WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  -- 卡片標題顯示誰：peer_pending / peer_agreed / peer_rejected → 顯示 requester (申請人)
  -- step_assigned (主管視角) → 顯示 requester；request_approved/rejected → 顯示 requester
  v_show_name := v_row.requester;
  IF v_row.requester_id IS NOT NULL THEN
    SELECT COALESCE(d.name, e.dept) INTO v_show_dept
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.id = v_row.requester_id;
  END IF;

  v_extra := jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','對象','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_row.target, '—'),
          'size','sm','color',v_text_body,'weight','bold','flex',5)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','日期','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', to_char(v_row.swap_date, 'YYYY-MM-DD'),
          'size','sm','color',v_text_body,'flex',5)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','班別交換','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text',
          COALESCE(v_row.requester_shift, '—') || ' ↔ ' || COALESCE(v_row.target_shift, '—'),
          'size','sm','color',v_text_body,'weight','bold','flex',5)
      )
    )
  );

  IF v_row.store IS NOT NULL AND v_row.store <> '' THEN
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','門市','size','sm','color',v_text_label,'flex',2),
          jsonb_build_object('type','text','text', v_row.store,
            'size','sm','color',v_text_body,'flex',5)
        )
      )
    );
  END IF;

  -- 拒絕原因（peer_rejected 用 peer_reject_reason；request_rejected 用 reject_reason）
  IF p_event = 'peer_rejected' THEN
    v_reject := v_row.peer_reject_reason;
  ELSIF p_event = 'request_rejected' THEN
    v_reject := v_row.reject_reason;
  END IF;

  IF COALESCE(btrim(v_reject), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FEF2F2','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','❌ 退回原因','size','xxs','color',v_color_danger,'weight','bold'),
          jsonb_build_object('type','text','text', v_reject,
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
          jsonb_build_object('type','text','text','📝 換班理由','size','xxs','color',v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  PERFORM public._push_hr_chain_flex(
    p_line_user_id, p_liff_id, 'shift_swap', p_id,
    v_show_name, v_show_dept, p_event, v_extra, v_reason
  );
END $$;


-- ═══ 3. _push_off_request_flex helper ═══
CREATE OR REPLACE FUNCTION public._push_off_request_flex(
  p_line_user_id text, p_liff_id text, p_id int, p_event text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row off_requests;
  v_emp_name text; v_dept text;
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';
  v_color_danger CONSTANT text := '#dc2626';
  v_extra jsonb := '[]'::jsonb;
  v_reason jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_row FROM off_requests WHERE id = p_id;
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
    )
  );

  IF v_row.store IS NOT NULL AND v_row.store <> '' THEN
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','門市','size','sm','color',v_text_label,'flex',2),
          jsonb_build_object('type','text','text', v_row.store,
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
          jsonb_build_object('type','text','text','📝 希望休原因','size','xxs','color',v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  PERFORM public._push_hr_chain_flex(
    p_line_user_id, p_liff_id, 'off_request', p_id,
    v_emp_name, v_dept, p_event, v_extra, v_reason
  );
END $$;


-- ═══ 4. helper：推單一 emp_id 的 LINE（找 line_user_id + liff_id） ═══
-- 已有 _notify_hr_request_applicant 但不夠通用；shift_swap 多場景需要直推任意 emp_id
CREATE OR REPLACE FUNCTION public._push_line_for_emp(
  p_rt    text,
  p_id    int,
  p_event text,
  p_emp_id int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_line text; v_liff text;
BEGIN
  IF p_emp_id IS NULL THEN RETURN; END IF;

  SELECT v.line_user_id, v.liff_id INTO v_line, v_liff
    FROM v_employee_line_resolved v
   WHERE v.employee_id = p_emp_id
   ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
   LIMIT 1;
  IF v_line IS NULL THEN RETURN; END IF;

  IF p_rt = 'shift_swap' THEN
    PERFORM public._push_shift_swap_flex(v_line, v_liff, p_id, p_event);
  ELSIF p_rt = 'off_request' THEN
    PERFORM public._push_off_request_flex(v_line, v_liff, p_id, p_event);
  END IF;
END $$;


-- ═══ 5. shift_swap trigger functions ═══
CREATE OR REPLACE FUNCTION public._trg_notify_shift_swap_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status <> '待對方同意' THEN RETURN NEW; END IF;

  -- 推 B (target_id)：你被邀請換班
  PERFORM public._push_line_for_emp('shift_swap', NEW.id, 'peer_pending', NEW.target_id);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_shift_swap_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_manager_id int;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  -- 待對方同意 → 待主管核准：推 store manager
  IF OLD.status = '待對方同意' AND NEW.status = '待主管核准' THEN
    SELECT manager_id INTO v_manager_id FROM stores WHERE id = NEW.store_id;
    IF v_manager_id IS NOT NULL THEN
      PERFORM public._push_line_for_emp('shift_swap', NEW.id, 'step_assigned', v_manager_id);
    END IF;

  -- 待對方同意 → 已拒絕：推 A (requester)
  ELSIF OLD.status = '待對方同意' AND NEW.status = '已拒絕' THEN
    PERFORM public._push_line_for_emp('shift_swap', NEW.id, 'peer_rejected', NEW.requester_id);

  -- 待主管核准 → 已核准：推 A + B
  ELSIF OLD.status = '待主管核准' AND NEW.status = '已核准' THEN
    PERFORM public._push_line_for_emp('shift_swap', NEW.id, 'request_approved', NEW.requester_id);
    PERFORM public._push_line_for_emp('shift_swap', NEW.id, 'request_approved', NEW.target_id);

  -- 待主管核准 → 已駁回：推 A + B
  ELSIF OLD.status = '待主管核准' AND NEW.status = '已駁回' THEN
    PERFORM public._push_line_for_emp('shift_swap', NEW.id, 'request_rejected', NEW.requester_id);
    PERFORM public._push_line_for_emp('shift_swap', NEW.id, 'request_rejected', NEW.target_id);
  END IF;

  RETURN NEW;
END $$;


-- ═══ 6. off_request trigger functions ═══
CREATE OR REPLACE FUNCTION public._trg_notify_off_request_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int := 0;
  v_line  record;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status <> '待審核' THEN RETURN NEW; END IF;
  IF NEW.employee_id IS NULL THEN RETURN NEW; END IF;

  -- 推所有 HR-style approvers
  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
      FROM _resolve_hr_approver_ids(NEW.employee_id) ap_id
      JOIN v_employee_line_resolved v ON v.employee_id = ap_id
     WHERE v.line_user_id IS NOT NULL
  LOOP
    PERFORM public._push_off_request_flex(v_line.line_user_id, v_line.liff_id, NEW.id, 'step_assigned');
    v_count := v_count + 1;
  END LOOP;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._trg_notify_off_request_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    PERFORM public._push_line_for_emp('off_request', NEW.id, 'request_approved', NEW.employee_id);
  ELSIF NEW.status = '已駁回' AND OLD.status IS DISTINCT FROM '已駁回' THEN
    PERFORM public._push_line_for_emp('off_request', NEW.id, 'request_rejected', NEW.employee_id);
  END IF;

  RETURN NEW;
END $$;


-- ═══ 7. 掛 trigger ═══
DROP TRIGGER IF EXISTS trg_notify_shift_swap_inserted ON public.shift_swaps;
CREATE TRIGGER trg_notify_shift_swap_inserted AFTER INSERT ON public.shift_swaps
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_shift_swap_inserted();
DROP TRIGGER IF EXISTS trg_notify_shift_swap_updated ON public.shift_swaps;
CREATE TRIGGER trg_notify_shift_swap_updated AFTER UPDATE ON public.shift_swaps
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_shift_swap_updated();

DROP TRIGGER IF EXISTS trg_notify_off_request_inserted ON public.off_requests;
CREATE TRIGGER trg_notify_off_request_inserted AFTER INSERT ON public.off_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_off_request_inserted();
DROP TRIGGER IF EXISTS trg_notify_off_request_updated ON public.off_requests;
CREATE TRIGGER trg_notify_off_request_updated AFTER UPDATE ON public.off_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_off_request_updated();


COMMIT;

NOTIFY pgrst, 'reload schema';
