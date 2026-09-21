-- HR 簽核卡附件:統一取附件 helper + 共用卡 _push_hr_chain_flex 加附件顯示 — 2026-08-07
-- 所有 HR 簽核卡(請假/加班/出差/補打卡/離職/留停/異動/增補)附件顯示在卡片上:
--   每個附件一列「📎 檔名」純連結,點開檔案(不內嵌圖片)。上限 6 個,超過提示看詳情。
-- 附件來源:form_attachments(新式表單) ∪ 直接欄位(leave.attachments[]/resignation.attachment_url)。
-- _push_hr_chain_flex dump live 定義,只加 DECLARE 變數 + 附件區塊,其餘逐字保留。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._hr_request_attachments(p_rt text, p_id int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v jsonb := '[]'::jsonb;
  v_base text := 'https://mvkvnuxeamahhfahclmi.supabase.co/storage/v1/object/public/';
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'url',  v_base || COALESCE(fa.storage_bucket,'attachments') || '/' || fa.storage_path,
           'name', fa.file_name)), '[]'::jsonb)
    INTO v
    FROM public.form_attachments fa
   WHERE fa.form_type = p_rt AND fa.form_id = p_id;

  IF p_rt = 'leave' THEN
    v := v || COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('url', u, 'name', regexp_replace(u, '^.*/', '')))
         FROM public.leave_requests lr, unnest(lr.attachments) AS u
        WHERE lr.id = p_id AND lr.attachments IS NOT NULL), '[]'::jsonb);
  ELSIF p_rt = 'resignation' THEN
    v := v || COALESCE(
      (SELECT jsonb_build_array(jsonb_build_object('url', rr.attachment_url, 'name', regexp_replace(rr.attachment_url, '^.*/', '')))
         FROM public.resignation_requests rr
        WHERE rr.id = p_id AND rr.attachment_url IS NOT NULL), '[]'::jsonb);
  END IF;

  RETURN v;
END $fn$;
GRANT EXECUTE ON FUNCTION public._hr_request_attachments(text, int) TO authenticated, service_role, anon;

CREATE OR REPLACE FUNCTION public._push_hr_chain_flex(p_line_user_id text, p_liff_id text, p_rt text, p_id integer, p_applicant text, p_dept text, p_event text, p_extra_rows jsonb, p_reason_block jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_push_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon       CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';

  v_text_white       CONSTANT text := '#FFFFFF';
  v_text_white_muted CONSTANT text := '#FFFFFFAA';
  v_text_title       CONSTANT text := '#111827';
  v_text_secondary   CONSTANT text := '#666666';

  v_header_color    text;
  v_subtitle        text;
  v_emoji           text;
  v_label           text;
  v_status_chip     text;
  v_alt_text        text;
  v_liff_url        text;
  v_liff_extra_url  text;
  v_payload         jsonb;
  v_rows            jsonb;
  v_applicant_inner jsonb;
  v_footer_buttons  jsonb := '[]'::jsonb;
  v_header          jsonb;
  v_body            jsonb;
  v_footer          jsonb;
  v_atts            jsonb;
  v_i               int;
  v_url             text;
  v_name            text;
BEGIN
  IF p_line_user_id IS NULL OR p_line_user_id = '' THEN RETURN; END IF;

  -- palette by rt
  CASE p_rt
    WHEN 'resignation' THEN
      v_header_color := '#6b7280'; v_subtitle := '#E5E7EB'; v_emoji := '📤'; v_label := '離職申請';
    WHEN 'transfer' THEN
      v_header_color := '#8b5cf6'; v_subtitle := '#E9D5FF'; v_emoji := '🔄'; v_label := '異動申請';
    WHEN 'loa' THEN
      v_header_color := '#f59e0b'; v_subtitle := '#FDE68A'; v_emoji := '⏸';   v_label := '留職停薪';
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
  ELSIF p_event = 'rejected_notify_signer' THEN
    v_status_chip := '你簽過·已退回';
    v_alt_text := v_emoji || ' ' || v_label || '(你簽核過)已被退回 — ' || COALESCE(p_applicant, '');
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

  -- ── 附件:純連結(所有 HR 簽核卡通用;來源統一 helper);點檔名開附件 ──
  v_atts := public._hr_request_attachments(p_rt, p_id);
  IF v_atts IS NOT NULL AND jsonb_array_length(v_atts) > 0 THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object('type','text','text','📎 附件 (' || jsonb_array_length(v_atts) || ')',
        'size','xs','color','#8A8A8A','weight','bold','margin','md')
    );
    FOR v_i IN 0 .. LEAST(jsonb_array_length(v_atts), 6) - 1 LOOP
      v_url  := v_atts -> v_i ->> 'url';
      v_name := COALESCE(v_atts -> v_i ->> 'name', '附件');
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'type','text','text','📎 ' || v_name,'size','sm','color','#1E88E5','wrap',true,'margin','sm',
        'action', jsonb_build_object('type','uri','uri',v_url)));
    END LOOP;
    IF jsonb_array_length(v_atts) > 6 THEN
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'type','text','text','⋯ 還有 ' || (jsonb_array_length(v_atts)-6) || ' 個,點詳情看',
        'size','xxs','color','#AAAAAA','margin','sm'));
    END IF;
  END IF;

  v_body := jsonb_build_object(
    'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '16px',
    'contents', v_rows
  );

  -- ── footer ──
  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
                  || '?to=%2Fapprove%3Ftype%3D' || p_rt || '%26id%3D' || p_id::text;
    -- 加簽深連結：帶 extra=1 讓 LIFF 直接捲到加簽區
    v_liff_extra_url := v_liff_url || '%26extra%3D1';

    IF p_event = 'step_assigned' THEN
      -- Row 1: 核准（postback） + 駁回（postback）
      -- Row 2: 加簽（LIFF）+ 詳情（LIFF）
      v_footer_buttons := jsonb_build_array(
        jsonb_build_object(
          'type','box','layout','horizontal','spacing','sm',
          'contents', jsonb_build_array(
            jsonb_build_object(
              'type','button','style','primary','color','#16a34a','height','sm','flex',1,
              'action', jsonb_build_object(
                'type','postback',
                'label','✅ 核准',
                'data', 'action=approve&type=request&rt=' || p_rt || '&id=' || p_id::text,
                'displayText','✅ 核准'
              )
            ),
            jsonb_build_object(
              'type','button','style','primary','color','#dc2626','height','sm','flex',1,
              'action', jsonb_build_object(
                'type','postback',
                'label','❌ 駁回',
                'data', 'action=reject&type=request&rt=' || p_rt || '&id=' || p_id::text,
                'displayText','❌ 駁回'
              )
            )
          )
        ),
        jsonb_build_object(
          'type','box','layout','horizontal','spacing','sm','margin','sm',
          'contents', jsonb_build_array(
            jsonb_build_object(
              'type','button','style','secondary','height','sm','flex',1,
              'action', jsonb_build_object(
                'type','uri',
                'label','✍️ 加簽',
                'uri', v_liff_extra_url
              )
            ),
            jsonb_build_object(
              'type','button','style','secondary','height','sm','flex',1,
              'action', jsonb_build_object(
                'type','uri',
                'label','📋 詳情',
                'uri', v_liff_url
              )
            )
          )
        )
      );
    ELSE
      -- request_approved / request_rejected / rejected_notify_signer: 只有查看詳情
      v_footer_buttons := jsonb_build_array(
        jsonb_build_object(
          'type','button',
          'action', jsonb_build_object('type','uri','label','📋 查看詳情','uri', v_liff_url),
          'style','primary','color', v_header_color,'height','sm'
        )
      );
    END IF;
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
END $function$

