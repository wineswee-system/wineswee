-- ════════════════════════════════════════════════════════════════════════════
-- 加簽功能 P3d — LINE postback for 加簽核准（不用進 LIFF 就能核准）
--
-- 改 _push_extra_signer_expense_flex：event='extra_assigned' 時，footer 增加
-- 「✅ 核准加簽」postback 按鈕，跟「📋 查看詳情」LIFF 按鈕並排
--
-- 退回因為需要填原因 → 不做 postback（保持「查看詳情 → LIFF 填原因」流程）
-- 撤銷加簽 → 從 Web/LIFF UI 觸發，不從 LINE 卡上做
--
-- postback data 格式：action=approve&type=extra&extra_id=X
-- 對應 postback-approval.ts 註冊 approve:extra handler
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._push_extra_signer_expense_flex(
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
  v_req               expense_requests;
  v_amount_str        text;
  v_requester_name    text;
  v_assignee_name     text;
  v_alt_text          text;
  v_emoji             text;
  v_label             text;
  v_status_chip       text;
  v_liff_url          text;
  v_postback_approve  text;

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
  IF v_extra.id IS NULL OR v_extra.source_table <> 'expense_requests' THEN RETURN; END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = v_extra.source_id;
  IF v_req.id IS NULL THEN RETURN; END IF;

  SELECT name INTO v_requester_name FROM employees WHERE id = v_extra.requested_by_id;
  SELECT name INTO v_assignee_name  FROM employees WHERE id = v_extra.assignee_id;

  v_amount_str := 'NT$ ' || to_char(COALESCE(v_req.estimated_amount, 0), 'FM999,999,999,999');

  IF p_event = 'extra_assigned' THEN
    v_emoji := '🪶';
    v_label := '加簽請求';
    v_status_chip := '待你處理';
    v_alt_text := '🪶 加簽請求 — ' || COALESCE(v_req.title, '');
  ELSIF p_event = 'extra_approved_back' THEN
    v_emoji := '✅';
    v_label := '加簽已通過';
    v_status_chip := '請繼續簽核';
    v_alt_text := '✅ 加簽通過 — ' || COALESCE(v_req.title, '') || ' / ' || COALESCE(v_assignee_name, '');
  ELSIF p_event = 'extra_rejected_back' THEN
    v_emoji := '❌';
    v_label := '加簽退回';
    v_status_chip := '單據已退回';
    v_alt_text := '❌ 加簽退回 — ' || COALESCE(v_req.title, '');
  ELSIF p_event = 'extra_cancelled_info' THEN
    v_emoji := '↩️';
    v_label := '加簽已撤銷';
    v_status_chip := '無需處理';
    v_alt_text := '↩️ 加簽已撤銷 — ' || COALESCE(v_req.title, '');
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
      jsonb_build_object('type','text','text', '#' || v_req.id::text || ' · 加簽 #' || v_extra.id::text,
        'color', v_subtitle, 'size', 'xs', 'margin', 'xs')
    )
  );

  IF p_event = 'extra_assigned' THEN
    v_rows := jsonb_build_array(
      jsonb_build_object('type','text',
        'text', COALESCE(v_requester_name, '') || ' 邀請你協助加簽',
        'size','md','color', v_text_title,'weight','bold','wrap',true)
    );
  ELSIF p_event = 'extra_approved_back' THEN
    v_rows := jsonb_build_array(
      jsonb_build_object('type','text',
        'text', COALESCE(v_assignee_name, '') || ' 已加簽通過，請繼續您的簽核',
        'size','md','color', v_text_title,'weight','bold','wrap',true)
    );
  ELSIF p_event = 'extra_rejected_back' THEN
    v_rows := jsonb_build_array(
      jsonb_build_object('type','text',
        'text', '加簽人 ' || COALESCE(v_assignee_name, '') || ' 退回了此單',
        'size','md','color', v_color_danger,'weight','bold','wrap',true)
    );
  ELSIF p_event = 'extra_cancelled_info' THEN
    v_rows := jsonb_build_array(
      jsonb_build_object('type','text',
        'text', COALESCE(v_requester_name, '') || ' 撤銷了加簽請求',
        'size','md','color', v_text_secondary,'weight','bold','wrap',true)
    );
  END IF;

  v_rows := v_rows || jsonb_build_array(jsonb_build_object('type','separator','margin','md'));

  v_rows := v_rows || jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','案件','size','sm','color', v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_req.title, '—'),
          'size','sm','color', v_text_body, 'flex',5, 'wrap', true)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','申請人','size','sm','color', v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_req.employee, '—'),
          'size','sm','color', v_text_body, 'flex',5, 'wrap', true)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','金額','size','sm','color', v_text_label,'flex',2),
        jsonb_build_object('type','text','text', v_amount_str,
          'size','sm','color', v_text_body, 'flex',5, 'weight','bold')
      )
    )
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

  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
                  || '?to=%2Fapprove%2Fexpense-request%3Fid%3D' || v_req.id::text;
  END IF;

  -- ★ P3d footer：assigned 時兩鈕（核准加簽 postback + 查看詳情 LIFF）
  IF p_event = 'extra_assigned' THEN
    v_postback_approve := 'action=approve&type=extra&extra_id=' || v_extra.id::text;

    v_footer_buttons := jsonb_build_array(
      jsonb_build_object(
        'type','button',
        'action', jsonb_build_object('type','postback','label','✅ 核准加簽','data', v_postback_approve),
        'style','primary','color', v_color_success,'height','sm'
      )
    );

    IF v_liff_url IS NOT NULL THEN
      v_footer_buttons := v_footer_buttons || jsonb_build_array(
        jsonb_build_object(
          'type','button',
          'action', jsonb_build_object('type','uri','label','📋 查看 / 退回','uri', v_liff_url),
          'style','secondary','height','sm'
        )
      );
    END IF;

  ELSE
    -- back 系列（approved_back / rejected_back / cancelled_info）：只放查看詳情
    IF v_liff_url IS NOT NULL THEN
      v_footer_buttons := jsonb_build_array(
        jsonb_build_object(
          'type','button',
          'action', jsonb_build_object('type','uri','label', '📋 查看詳情','uri', v_liff_url),
          'style','primary','color',
            CASE p_event WHEN 'extra_approved_back' THEN v_color_success
                         WHEN 'extra_rejected_back' THEN v_color_danger
                         ELSE '#6b7280' END,
          'height','sm'
        )
      );
    END IF;
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

NOTIFY pgrst, 'reload schema';
