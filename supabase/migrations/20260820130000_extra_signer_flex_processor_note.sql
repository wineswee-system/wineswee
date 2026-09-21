-- 加簽 LINE 卡片:「加簽已通過回到發起人」(extra_approved_back)加顯示加簽人核准回覆(processor_note)。
-- 兩支 flex builder 全量對齊 live(含既有 push url/anon)。
CREATE OR REPLACE FUNCTION public._push_extra_signer_expense_flex(p_line_user_id text, p_liff_id text, p_extra_id integer, p_event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_push_url    CONSTANT text := 'https://uoernfpfieurtjqwbnii.supabase.co/functions/v1/line-push';
  v_anon        CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvZXJuZnBmaWV1cnRqcXdibmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3Nzg0NDUsImV4cCI6MjEwMDM1NDQ0NX0.jubKj63U9L4GiosFbu0p530zepbcdVTG86XSua1SnsU';
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
  v_header            jsonb;
  v_body              jsonb;
  v_footer            jsonb;
  v_rows              jsonb := '[]'::jsonb;
  v_reason_block      jsonb := '[]'::jsonb;
  v_footer_buttons    jsonb := '[]'::jsonb;
  v_payload           jsonb;
BEGIN
  IF p_line_user_id IS NULL OR p_line_user_id = '' THEN RETURN; END IF;

  SELECT * INTO v_extra FROM approval_extra_steps WHERE id = p_extra_id;
  -- 支援 expense_requests + expense_settles（source_id 都是 expense_requests.id）
  IF v_extra.id IS NULL OR
     v_extra.source_table NOT IN ('expense_requests', 'expense_settles') THEN RETURN; END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = v_extra.source_id;
  IF v_req.id IS NULL THEN RETURN; END IF;

  SELECT name INTO v_requester_name FROM employees WHERE id = v_extra.requested_by_id;
  SELECT name INTO v_assignee_name  FROM employees WHERE id = v_extra.assignee_id;

  v_amount_str := 'NT$ ' || to_char(
    COALESCE(v_req.actual_amount, v_req.estimated_amount, 0), 'FM999,999,999,999'
  );

  IF p_event = 'extra_assigned' THEN
    v_emoji := '🪶'; v_label := CASE v_extra.source_table
      WHEN 'expense_settles' THEN '核銷加簽請求' ELSE '加簽請求' END;
    v_status_chip := '待你處理';
    v_alt_text := '🪶 ' || v_label || ' — ' || COALESCE(v_req.title, '');
  ELSIF p_event = 'extra_approved_back' THEN
    v_emoji := '✅'; v_label := '加簽已通過';
    v_status_chip := '請繼續簽核';
    v_alt_text := '✅ 加簽已通過，請繼續簽核';
  ELSIF p_event = 'extra_rejected_back' THEN
    v_emoji := '❌'; v_label := '加簽人退回';
    v_status_chip := '已退回';
    v_alt_text := '❌ 加簽人退回此單';
  ELSE -- extra_cancelled_info
    v_emoji := '🚫'; v_label := '加簽已撤銷';
    v_status_chip := '已撤銷';
    v_alt_text := '🚫 加簽請求已撤銷';
  END IF;

  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
      || '?to=%2Fapprove%3Ftype%3D' || v_extra.source_table
      || '%26id%3D' || v_extra.source_id::text;
  END IF;

  v_header := jsonb_build_object(
    'type','box','layout','vertical','paddingAll','16px','backgroundColor', v_header_color,
    'contents', jsonb_build_array(
      jsonb_build_object('type','box','layout','horizontal','contents', jsonb_build_array(
        jsonb_build_object('type','text','text', v_emoji || ' ' || v_label,
          'color', v_text_white,'weight','bold','size','lg','flex',5),
        jsonb_build_object('type','text','text', v_status_chip,
          'color', v_text_white_muted,'size','xs','align','end','gravity','center','flex',3)
      )),
      jsonb_build_object('type','text','text','#' || v_extra.source_id::text,
        'color', v_subtitle,'size','xs','margin','xs')
    )
  );

  v_rows := jsonb_build_array(
    jsonb_build_object('type','box','layout','horizontal','spacing','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','📋','size','lg','flex',0),
        jsonb_build_object('type','box','layout','vertical','flex',7,'contents', jsonb_build_array(
          jsonb_build_object('type','text','text', COALESCE(v_req.title, '—'),
            'weight','bold','size','md','color', v_text_title),
          jsonb_build_object('type','text','text', COALESCE(v_req.employee,''),
            'size','xs','color', v_text_secondary,'margin','none')
        ))
      )
    ),
    jsonb_build_object('type','separator','margin','md'),
    jsonb_build_object('type','box','layout','horizontal','margin','sm','contents', jsonb_build_array(
      jsonb_build_object('type','text','text','金額','size','sm','color', v_text_label,'flex',2),
      jsonb_build_object('type','text','text', v_amount_str,'size','sm','weight','bold',
        'color', v_text_body,'flex',5,'wrap',true)
    )),
    jsonb_build_object('type','box','layout','horizontal','margin','sm','contents', jsonb_build_array(
      jsonb_build_object('type','text','text',
        CASE p_event WHEN 'extra_assigned' THEN '發起人' ELSE '加簽人' END,
        'size','sm','color', v_text_label,'flex',2),
      jsonb_build_object('type','text','text',
        CASE p_event WHEN 'extra_assigned' THEN COALESCE(v_requester_name,'—')
             ELSE COALESCE(v_assignee_name,'—') END,
        'size','sm','color', v_text_body,'flex',5,'wrap',true)
    ))
  );

  IF v_extra.reason IS NOT NULL AND btrim(v_extra.reason) <> '' THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object('type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FFF7ED','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 加簽原因','size','xxs','color','#C2410C','weight','bold'),
          jsonb_build_object('type','text','text', v_extra.reason,'size','sm','color', v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  -- 加簽人核准回覆(processor_note):在「加簽已通過回到發起人」卡顯示,讓發起加簽的下一關看到判斷
  IF p_event = 'extra_approved_back' AND v_extra.processor_note IS NOT NULL AND btrim(v_extra.processor_note) <> '' THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object('type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F0FDF4','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','✅ 加簽回覆','size','xxs','color','#15803D','weight','bold'),
          jsonb_build_object('type','text','text', v_extra.processor_note,'size','sm','color', v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  v_body := jsonb_build_object('type','box','layout','vertical','spacing','sm',
    'paddingAll','16px','contents', v_rows);

  IF v_liff_url IS NOT NULL THEN
    v_footer_buttons := jsonb_build_array(
      jsonb_build_object('type','button',
        'action', jsonb_build_object('type','uri','label','📋 查看詳情','uri', v_liff_url),
        'style','secondary','height','sm')
    );
  END IF;

  v_footer := jsonb_build_object('type','box','layout','vertical','spacing','sm',
    'paddingAll','12px','contents', v_footer_buttons);

  v_payload := jsonb_build_object(
    'to', p_line_user_id,
    'messages', jsonb_build_array(
      jsonb_build_object('type','flex','altText', v_alt_text,
        'contents', jsonb_build_object(
          'type','bubble','size','kilo',
          'header', v_header,'body', v_body,'footer', v_footer
        )
      )
    )
  );

  PERFORM net.http_post(
    url     := v_push_url,
    body    := v_payload,
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || v_anon
    ),
    timeout_milliseconds := 8000
  );
END $function$
;

CREATE OR REPLACE FUNCTION public._push_extra_signer_generic_flex(p_line_user_id text, p_liff_id text, p_extra_id integer, p_event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_push_url CONSTANT text := 'https://uoernfpfieurtjqwbnii.supabase.co/functions/v1/line-push';
  v_anon     CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvZXJuZnBmaWV1cnRqcXdibmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3Nzg0NDUsImV4cCI6MjEwMDM1NDQ0NX0.jubKj63U9L4GiosFbu0p530zepbcdVTG86XSua1SnsU';
  v_hdr      CONSTANT text := '#8b5cf6';   -- 加簽=特殊(紫)
  v_extra    approval_extra_steps;
  v_form_label text;
  v_applicant  text;
  v_requester  text;
  v_assignee   text;
  v_emoji text; v_label text; v_chip text; v_alt text;
  v_rows jsonb := '[]'::jsonb;
  v_footer_buttons jsonb := '[]'::jsonb;
  v_bubble jsonb;
  v_payload jsonb;
BEGIN
  IF p_line_user_id IS NULL OR p_line_user_id = '' THEN RETURN; END IF;
  SELECT * INTO v_extra FROM approval_extra_steps WHERE id = p_extra_id;
  IF v_extra.id IS NULL THEN RETURN; END IF;

  -- source_table → 單別中文
  v_form_label := CASE v_extra.source_table
    WHEN 'leave_requests' THEN '請假'
    WHEN 'overtime_requests' THEN '加班'
    WHEN 'business_trips' THEN '出差'
    WHEN 'clock_corrections' THEN '補打卡'
    WHEN 'off_requests' THEN '忘刷/外出'
    WHEN 'personnel_transfer_requests' THEN '人事異動'
    WHEN 'resignation_requests' THEN '離職'
    WHEN 'leave_of_absence_requests' THEN '留停'
    WHEN 'headcount_requests' THEN '人力需求'
    WHEN 'goods_transfer_requests' THEN '商品調撥'
    WHEN 'shift_cover_requests' THEN '換班/代班'
    WHEN 'store_audits' THEN '門市稽核'
    WHEN 'form_submissions' THEN '自訂表單'
    WHEN 'expenses' THEN '報帳'
    ELSE COALESCE(v_extra.source_table, '申請單')
  END;

  SELECT name INTO v_requester FROM employees WHERE id = v_extra.requested_by_id;
  SELECT name INTO v_assignee  FROM employees WHERE id = v_extra.assignee_id;
  -- 申請人：best-effort 撈來源表的 employee 文字欄(沒有就略過)
  BEGIN
    EXECUTE format('SELECT employee FROM public.%I WHERE id = $1', v_extra.source_table)
      INTO v_applicant USING v_extra.source_id;
  EXCEPTION WHEN others THEN v_applicant := NULL;
  END;

  IF p_event = 'extra_assigned' THEN
    v_emoji := '🪶'; v_label := v_form_label || ' 加簽請求'; v_chip := '待你會簽';
    v_alt := '🪶 ' || v_form_label || ' 加簽請求（請你會簽）';
  ELSIF p_event = 'extra_approved_back' THEN
    v_emoji := '✅'; v_label := v_form_label || ' 加簽已通過'; v_chip := '請繼續簽核';
    v_alt := '✅ 加簽已通過，請繼續簽核';
  ELSIF p_event = 'extra_rejected_back' THEN
    v_emoji := '❌'; v_label := v_form_label || ' 加簽人退回'; v_chip := '已退回';
    v_alt := '❌ 加簽人退回此單';
  ELSE
    v_emoji := '🚫'; v_label := v_form_label || ' 加簽已撤銷'; v_chip := '已撤銷';
    v_alt := '🚫 加簽請求已撤銷';
  END IF;

  v_rows := jsonb_build_array(
    jsonb_build_object('type','box','layout','horizontal','margin','sm','contents', jsonb_build_array(
      jsonb_build_object('type','text','text','單別','size','sm','color','#9CA3AF','flex',2),
      jsonb_build_object('type','text','text', v_form_label || '（#' || v_extra.source_id::text || '）',
        'size','sm','weight','bold','color','#333333','flex',5,'wrap',true)))
  );
  IF v_applicant IS NOT NULL AND btrim(v_applicant) <> '' THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('type','box','layout','horizontal','margin','sm','contents', jsonb_build_array(
        jsonb_build_object('type','text','text','申請人','size','sm','color','#9CA3AF','flex',2),
        jsonb_build_object('type','text','text', v_applicant,'size','sm','color','#333333','flex',5,'wrap',true))));
  END IF;
  v_rows := v_rows || jsonb_build_array(
    jsonb_build_object('type','box','layout','horizontal','margin','sm','contents', jsonb_build_array(
      jsonb_build_object('type','text','text',
        CASE p_event WHEN 'extra_assigned' THEN '加簽發起' ELSE '加簽人' END,
        'size','sm','color','#9CA3AF','flex',2),
      jsonb_build_object('type','text','text',
        CASE p_event WHEN 'extra_assigned' THEN COALESCE(v_requester,'—') ELSE COALESCE(v_assignee,'—') END,
        'size','sm','color','#333333','flex',5,'wrap',true))));

  IF v_extra.reason IS NOT NULL AND btrim(v_extra.reason) <> '' THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object('type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F5F3FF','cornerRadius','8px','contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 加簽原因','size','xxs','color','#6D28D9','weight','bold'),
          jsonb_build_object('type','text','text', v_extra.reason,'size','sm','color','#333333','wrap',true,'margin','sm'))));
  END IF;

  IF p_event = 'extra_approved_back' AND v_extra.processor_note IS NOT NULL AND btrim(v_extra.processor_note) <> '' THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object('type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F0FDF4','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','✅ 加簽回覆','size','xxs','color','#15803D','weight','bold'),
          jsonb_build_object('type','text','text', v_extra.processor_note,'size','sm','color','#333333','wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  -- 只有「指派給加簽人」時給核准/退回鈕（走 webhook type=extra postback，process_extra_signer 通用）
  -- + 「進 LIFF 看詳情」（深連結 ?id=source_id，LIFF 會展開該單）
  IF p_event = 'extra_assigned' THEN
    v_footer_buttons := jsonb_build_array(
      jsonb_build_object('type','button','style','primary','color','#16a34a','height','sm',
        'action', jsonb_build_object('type','postback','label','✅ 核准會簽',
          'data','action=approve&type=extra&extra_id=' || v_extra.id::text,'displayText','核准加簽')),
      jsonb_build_object('type','button','style','secondary','height','sm',
        'action', jsonb_build_object('type','postback','label','❌ 退回',
          'data','action=reject&type=extra&extra_id=' || v_extra.id::text,'displayText','退回加簽')));
    IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
      v_footer_buttons := v_footer_buttons || jsonb_build_array(
        jsonb_build_object('type','button','style','link','height','sm',
          'action', jsonb_build_object('type','uri','label','📋 進 LIFF 看詳情',
            'uri','https://liff.line.me/' || p_liff_id || '?id=' || v_extra.source_id::text)));
    END IF;
  END IF;

  v_bubble := jsonb_build_object(
    'type','bubble','size','kilo',
    'header', jsonb_build_object('type','box','layout','vertical','paddingAll','16px','backgroundColor', v_hdr,
      'contents', jsonb_build_array(
        jsonb_build_object('type','box','layout','horizontal','contents', jsonb_build_array(
          jsonb_build_object('type','text','text', v_emoji || ' ' || v_label,'color','#FFFFFF','weight','bold','size','md','flex',5,'wrap',true),
          jsonb_build_object('type','text','text', v_chip,'color','#FFFFFFAA','size','xs','align','end','gravity','center','flex',3))))),
    'body', jsonb_build_object('type','box','layout','vertical','spacing','sm','paddingAll','16px','contents', v_rows));
  -- 有按鈕才放 footer（空 footer LINE 會拒收）
  IF jsonb_array_length(v_footer_buttons) > 0 THEN
    v_bubble := v_bubble || jsonb_build_object('footer',
      jsonb_build_object('type','box','layout','vertical','spacing','sm','paddingAll','12px','contents', v_footer_buttons));
  END IF;

  v_payload := jsonb_build_object('to', p_line_user_id, 'messages', jsonb_build_array(
    jsonb_build_object('type','flex','altText', v_alt, 'contents', v_bubble)));

  PERFORM net.http_post(
    url := v_push_url, body := v_payload, params := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_anon),
    timeout_milliseconds := 8000);
END $function$
;
