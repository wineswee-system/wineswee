-- ════════════════════════════════════════════════════════════════════════════
-- 加簽功能 P3e — 後端擴展支援其他 8 個 source_table
--
-- P2 + P3d 已完整支援 expense_requests。
-- P3e 把 backend skeleton 鋪到其他 chain：
--   - HR forms (5):  leave_requests / overtime_requests / business_trips
--                    clock_corrections / expenses
--   - HR personnel (3): resignation_requests / personnel_transfer_requests
--                       leave_of_absence_requests
--
-- 任務 (tasks) 暫不納入：task_chain 用 task_confirmations 多筆 row 推進，
-- 加簽插入語意需要另外設計（P3e+ future）。
--
-- 內容：
--   1. _push_extra_signer_generic_flex   — 非 expense_request 用的簡化加簽卡
--                                          支援 4 event 變體 + 加簽核准 postback
--   2. _notify_extra_signer              — dispatch 改：expense_request 走專用 flex；
--                                          其他走 generic flex
--   3. _trg_extra_signer_updated         — 移除 expense_requests-only early return；
--                                          rejected 時 dispatch by source_table 更新 source row
--
-- 未涵蓋（待後續 phase）：
--   - 各 chain RPC 加 pending extra guard（liff_approve_request /
--     hr_chain_approve 都很大、需個別測試，沒 UI 觸發前保留現狀）
--   - 各 chain 前端 / LIFF 加簽 UI（複製 P3a / P3c pattern）
--   - task_chain 加簽（需另設計）
-- ════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. _push_extra_signer_generic_flex — 通用加簽卡（HR 8 表共用）
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._push_extra_signer_generic_flex(
  p_line_user_id text,
  p_liff_id      text,
  p_extra_id     int,
  p_event        text   -- 'extra_assigned' | 'extra_approved_back' | 'extra_rejected_back' | 'extra_cancelled_info'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_push_url    CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon        CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_header_color      CONSTANT text := '#f97316';
  v_subtitle          CONSTANT text := '#FED7AA';
  v_text_white        CONSTANT text := '#FFFFFF';
  v_text_white_muted  CONSTANT text := '#FFFFFFAA';
  v_text_title        CONSTANT text := '#111827';
  v_text_body         CONSTANT text := '#333333';
  v_text_secondary    CONSTANT text := '#666666';
  v_text_label        CONSTANT text := '#9CA3AF';
  v_color_success     CONSTANT text := '#16a34a';
  v_color_danger      CONSTANT text := '#dc2626';

  v_extra             approval_extra_steps;
  v_table_label       text;
  v_requester_name    text;
  v_assignee_name     text;
  v_alt_text          text;
  v_emoji             text;
  v_label             text;
  v_status_chip       text;
  v_liff_url          text;
  v_postback_approve  text;
  v_main_msg          text;

  v_header            jsonb;
  v_body              jsonb;
  v_footer            jsonb;
  v_rows              jsonb := '[]'::jsonb;
  v_reason_block      jsonb := '[]'::jsonb;
  v_footer_buttons    jsonb := '[]'::jsonb;
  v_payload           jsonb;
  v_bubble            jsonb;
BEGIN
  IF p_line_user_id IS NULL OR p_line_user_id = '' THEN RETURN; END IF;

  SELECT * INTO v_extra FROM approval_extra_steps WHERE id = p_extra_id;
  IF v_extra.id IS NULL THEN RETURN; END IF;

  -- 中文表名 lookup
  v_table_label := CASE v_extra.source_table
    WHEN 'leave_requests'              THEN '請假申請'
    WHEN 'overtime_requests'           THEN '加班申請'
    WHEN 'business_trips'              THEN '出差申請'
    WHEN 'clock_corrections'           THEN '補打卡'
    WHEN 'expenses'                    THEN '費用報帳'
    WHEN 'resignation_requests'        THEN '離職申請'
    WHEN 'personnel_transfer_requests' THEN '人事異動'
    WHEN 'leave_of_absence_requests'   THEN '留職停薪'
    ELSE v_extra.source_table
  END;

  SELECT name INTO v_requester_name FROM employees WHERE id = v_extra.requested_by_id;
  SELECT name INTO v_assignee_name  FROM employees WHERE id = v_extra.assignee_id;

  IF p_event = 'extra_assigned' THEN
    v_emoji := '🪶';
    v_label := '加簽請求';
    v_status_chip := '待你處理';
    v_main_msg := COALESCE(v_requester_name, '') || ' 邀請你協助加簽';
    v_alt_text := '🪶 加簽請求 — ' || v_table_label;
  ELSIF p_event = 'extra_approved_back' THEN
    v_emoji := '✅';
    v_label := '加簽已通過';
    v_status_chip := '請繼續簽核';
    v_main_msg := COALESCE(v_assignee_name, '') || ' 已加簽通過，請繼續您的簽核';
    v_alt_text := '✅ 加簽通過 — ' || v_table_label;
  ELSIF p_event = 'extra_rejected_back' THEN
    v_emoji := '❌';
    v_label := '加簽退回';
    v_status_chip := '單據已退回';
    v_main_msg := '加簽人 ' || COALESCE(v_assignee_name, '') || ' 退回了此單';
    v_alt_text := '❌ 加簽退回 — ' || v_table_label;
  ELSIF p_event = 'extra_cancelled_info' THEN
    v_emoji := '↩️';
    v_label := '加簽已撤銷';
    v_status_chip := '無需處理';
    v_main_msg := COALESCE(v_requester_name, '') || ' 撤銷了加簽請求';
    v_alt_text := '↩️ 加簽已撤銷 — ' || v_table_label;
  ELSE
    RETURN;
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
      jsonb_build_object('type','text','text', v_table_label || ' #' || v_extra.source_id::text,
        'color', v_subtitle, 'size', 'xs', 'margin', 'xs')
    )
  );

  -- Body：主訊息 + 加簽原因 / 退回原因
  v_rows := jsonb_build_array(
    jsonb_build_object('type','text', 'text', v_main_msg,
      'size','md','color', CASE p_event WHEN 'extra_rejected_back' THEN v_color_danger ELSE v_text_title END,
      'weight','bold','wrap',true)
  );

  IF v_extra.reason IS NOT NULL AND btrim(v_extra.reason) <> '' AND p_event IN ('extra_assigned', 'extra_approved_back') THEN
    v_reason_block := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FFF7ED','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 加簽原因','size','xxs',
            'color','#9A3412','weight','bold'),
          jsonb_build_object('type','text','text', v_extra.reason,
            'size','sm','color', v_text_body, 'wrap', true, 'margin', 'sm')
        )
      )
    );
  END IF;

  IF p_event = 'extra_rejected_back' AND v_extra.reject_reason IS NOT NULL AND btrim(v_extra.reject_reason) <> '' THEN
    v_reason_block := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FEF2F2','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','❌ 退回原因','size','xxs',
            'color', v_color_danger,'weight','bold'),
          jsonb_build_object('type','text','text', v_extra.reject_reason,
            'size','sm','color', v_text_body, 'wrap', true, 'margin', 'sm')
        )
      )
    );
  END IF;

  v_rows := v_rows || v_reason_block;

  v_body := jsonb_build_object(
    'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '16px',
    'contents', v_rows
  );

  -- footer：assigned 時 postback 核准加簽；其他事件只有 LIFF 連結
  IF p_event = 'extra_assigned' THEN
    v_postback_approve := 'action=approve&type=extra&extra_id=' || v_extra.id::text;
    v_footer_buttons := jsonb_build_array(
      jsonb_build_object(
        'type','button',
        'action', jsonb_build_object('type','postback','label','✅ 核准加簽','data', v_postback_approve),
        'style','primary','color', v_color_success,'height','sm'
      )
    );
    -- 註：非 expense_request 暫無 LIFF 加簽 UI，所以不放查看詳情；
    -- 待 P3c-extend (其他 chain LIFF UI) 完成後再加 LIFF link
  END IF;

  v_footer := jsonb_build_object(
    'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '12px',
    'contents', v_footer_buttons
  );

  v_bubble := jsonb_build_object(
    'type', 'bubble', 'size', 'kilo',
    'header', v_header,
    'body',   v_body,
    'footer', v_footer
  );

  v_payload := jsonb_build_object(
    'to', p_line_user_id,
    'messages', jsonb_build_array(
      jsonb_build_object('type', 'flex', 'altText', v_alt_text, 'contents', v_bubble)
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
END
$$;

GRANT EXECUTE ON FUNCTION public._push_extra_signer_generic_flex(text, text, int, text)
  TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. _notify_extra_signer — dispatch by source_table
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._notify_extra_signer(
  p_extra_id     int,
  p_target_emp_id int,
  p_event        text
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_extra approval_extra_steps;
  v_line  record;
  v_count int := 0;
BEGIN
  SELECT * INTO v_extra FROM approval_extra_steps WHERE id = p_extra_id;
  IF v_extra.id IS NULL THEN RETURN 0; END IF;

  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
      FROM v_employee_line_resolved v
     WHERE v.employee_id = p_target_emp_id
       AND v.line_user_id IS NOT NULL
     ORDER BY 1
  LOOP
    IF v_extra.source_table = 'expense_requests' THEN
      -- 專用 flex（有完整資料：金額、項目、明細）
      PERFORM public._push_extra_signer_expense_flex(
        v_line.line_user_id, v_line.liff_id, p_extra_id, p_event
      );
    ELSIF v_extra.source_table IN (
      'leave_requests', 'overtime_requests', 'business_trips',
      'clock_corrections', 'expenses',
      'resignation_requests', 'personnel_transfer_requests', 'leave_of_absence_requests'
    ) THEN
      -- HR 系列共用 generic flex
      PERFORM public._push_extra_signer_generic_flex(
        v_line.line_user_id, v_line.liff_id, p_extra_id, p_event
      );
    -- tasks 暫不支援
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END
$$;

GRANT EXECUTE ON FUNCTION public._notify_extra_signer(int, int, text) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. _trg_extra_signer_updated — dispatch source row update by source_table
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_extra_signer_updated()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_assignee_name text;
  v_combined_reject_reason text;
  v_supports boolean := false;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- 只支援我們處理的 source_table
  v_supports := NEW.source_table IN (
    'expense_requests',
    'leave_requests', 'overtime_requests', 'business_trips',
    'clock_corrections', 'expenses',
    'resignation_requests', 'personnel_transfer_requests', 'leave_of_absence_requests'
  );
  IF NOT v_supports THEN RETURN NEW; END IF;

  -- ── pending → approved: 推 LINE 回發起人「請繼續簽核」 ──
  IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
    PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_approved_back');
    RETURN NEW;
  END IF;

  -- ── pending → rejected: 整單退回 ──
  IF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
    SELECT name INTO v_assignee_name FROM employees WHERE id = NEW.assignee_id;
    v_combined_reject_reason := '加簽人 ' || COALESCE(v_assignee_name, '未知')
                                 || ' 退回：' || COALESCE(NEW.reject_reason, '');

    -- dispatch by source_table 更新單據狀態
    IF NEW.source_table = 'expense_requests' THEN
      UPDATE expense_requests
        SET status = '已駁回', reject_reason = v_combined_reject_reason, approved_at = NOW()
        WHERE id = NEW.source_id AND status IN ('申請中', '待審');

    ELSIF NEW.source_table = 'leave_requests' THEN
      UPDATE leave_requests
        SET status = '已退回', reject_reason = v_combined_reject_reason
        WHERE id = NEW.source_id AND status = '待審核';
    ELSIF NEW.source_table = 'overtime_requests' THEN
      UPDATE overtime_requests
        SET status = '已退回', reject_reason = v_combined_reject_reason
        WHERE id = NEW.source_id AND status = '待審核';
    ELSIF NEW.source_table = 'business_trips' THEN
      UPDATE business_trips
        SET status = '已退回', reject_reason = v_combined_reject_reason
        WHERE id = NEW.source_id AND status = '待審核';
    ELSIF NEW.source_table = 'clock_corrections' THEN
      UPDATE clock_corrections
        SET status = '已退回', reject_reason = v_combined_reject_reason
        WHERE id = NEW.source_id AND status = '待審核';
    ELSIF NEW.source_table = 'expenses' THEN
      UPDATE expenses
        SET status = '已退回', reject_reason = v_combined_reject_reason
        WHERE id = NEW.source_id AND status = '待審核';

    ELSIF NEW.source_table = 'resignation_requests' THEN
      UPDATE resignation_requests
        SET status = '已駁回', reject_reason = v_combined_reject_reason
        WHERE id = NEW.source_id AND status = '申請中';
    ELSIF NEW.source_table = 'personnel_transfer_requests' THEN
      UPDATE personnel_transfer_requests
        SET status = '已駁回', reject_reason = v_combined_reject_reason
        WHERE id = NEW.source_id AND status = '申請中';
    ELSIF NEW.source_table = 'leave_of_absence_requests' THEN
      UPDATE leave_of_absence_requests
        SET status = '已駁回', reject_reason = v_combined_reject_reason
        WHERE id = NEW.source_id AND status = '申請中';
    END IF;

    -- 推 LINE 給原發起人
    PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_rejected_back');
    RETURN NEW;
  END IF;

  -- ── pending → cancelled: 通知加簽人 ──
  IF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
    PERFORM public._notify_extra_signer(NEW.id, NEW.assignee_id, 'extra_cancelled_info');
    RETURN NEW;
  END IF;

  RETURN NEW;
END
$$;

-- trigger 本體不重建（trg_extra_signer_updated 已存在，function body 已改）

NOTIFY pgrst, 'reload schema';
