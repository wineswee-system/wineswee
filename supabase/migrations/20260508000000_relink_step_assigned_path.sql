-- ============================================================
-- Hotfix：20260507400000 升級 _push_task_chain_flex 內容時，把
-- 之前 20260507240000 修的 LIFF deeplink routing 蓋回舊版（全部都連
-- /tasks?task=ID）。這裡把 step_assigned 路徑接回 /task-confirmations。
--
-- 直接覆寫 _push_task_chain_flex（沿用 400000 的 enriched body，只改 deeplink）。
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._push_task_chain_flex(
  p_line_user_id        text,
  p_liff_id             text,
  p_task_id             int,
  p_task_title          text,
  p_step_label          text,
  p_step_order          int,
  p_chain_total         int,
  p_event               text,    -- 'step_assigned' | 'task_done' | 'task_rejected'
  p_recipient_approver  text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_push_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon       CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_liff_url   text;
  v_btn_label  text;
  v_color      text;
  v_header     text;
  v_alt_text   text;
  v_meta       jsonb;
  v_body       jsonb := '[]'::jsonb;
  v_step_text  text;
  v_step_color text;
  r            jsonb;
  v_step_subtitle text;
  v_payload    jsonb;
BEGIN
  IF p_line_user_id IS NULL OR p_line_user_id = '' THEN RETURN; END IF;

  -- 顏色 / 標題 / 按鈕標籤 / LIFF 內頁路徑 by event
  IF p_event = 'task_done' THEN
    v_color := '#22c55e'; v_header := '✅ 簽核完成';
    v_alt_text := '簽核完成：' || COALESCE(p_task_title, '');
    v_btn_label := '🔍 查看任務';
    IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
      v_liff_url := 'https://liff.line.me/' || p_liff_id
                    || '?to=%2Ftasks%3Ftask%3D' || p_task_id::text;
    END IF;
  ELSIF p_event = 'task_rejected' THEN
    v_color := '#ef4444'; v_header := '❌ 簽核退回';
    v_alt_text := '簽核退回：' || COALESCE(p_task_title, '');
    v_btn_label := '🔍 查看任務';
    IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
      v_liff_url := 'https://liff.line.me/' || p_liff_id
                    || '?to=%2Ftasks%3Ftask%3D' || p_task_id::text;
    END IF;
  ELSE  -- step_assigned
    v_color := '#06b6d4'; v_header := '🔐 待您簽核';
    v_alt_text := '待簽核：' || COALESCE(p_task_title, '');
    v_btn_label := '✔️ 前往簽核';
    IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
      v_liff_url := 'https://liff.line.me/' || p_liff_id || '?to=%2Ftask-confirmations';
    END IF;
  END IF;

  v_meta := public._resolve_task_chain_meta(p_task_id);

  -- (1) 標題
  v_body := v_body || jsonb_build_array(
    jsonb_build_object('type','text','text',COALESCE(p_task_title,''),'weight','bold','size','md','wrap',true)
  );

  -- (2) 類型 pill + step 副標
  v_step_subtitle := CASE
    WHEN p_event = 'step_assigned' AND p_chain_total IS NOT NULL THEN
      COALESCE(p_step_label,'') || ' (' || (COALESCE(p_step_order,0) + 1) || '/' || p_chain_total || ')'
    WHEN p_event = 'step_assigned' THEN COALESCE(p_step_label,'')
    WHEN p_event = 'task_done'     THEN '所有簽核關卡已通過'
    ELSE                                '簽核已退回'
  END;

  v_body := v_body || jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','spacing','md','margin','sm','alignItems','center',
      'contents', jsonb_build_array(
        jsonb_build_object(
          'type','box','layout','vertical','flex',0,
          'backgroundColor', v_meta->>'type_color',
          'cornerRadius','6px',
          'paddingTop','4px','paddingBottom','4px','paddingStart','10px','paddingEnd','10px',
          'contents', jsonb_build_array(
            jsonb_build_object('type','text','text',COALESCE(v_meta->>'type_label','一般'),
                               'color','#FFFFFF','size','xs','weight','bold','align','center')
          )
        ),
        jsonb_build_object('type','text','text',v_step_subtitle,
                           'size','xs','color','#666666','flex',1,'gravity','center','wrap',true)
      )
    ),
    jsonb_build_object('type','separator','margin','md')
  );

  -- (3) Meta rows（缺值的略過）
  IF v_meta->>'applicant_line' IS NOT NULL THEN
    v_body := v_body || jsonb_build_array(public._chain_meta_row('👤 申請人', v_meta->>'applicant_line'));
  END IF;
  IF v_meta->>'amount' IS NOT NULL THEN
    v_body := v_body || jsonb_build_array(public._chain_meta_row('💰 金額', v_meta->>'amount'));
  END IF;
  IF v_meta->>'account' IS NOT NULL THEN
    v_body := v_body || jsonb_build_array(public._chain_meta_row('📂 科目', v_meta->>'account'));
  END IF;
  IF v_meta->>'description' IS NOT NULL THEN
    v_body := v_body || jsonb_build_array(public._chain_meta_row('📝 說明', v_meta->>'description'));
  END IF;

  -- (4) 簽核進度列表
  IF jsonb_array_length(v_meta->'signed') > 0 OR jsonb_array_length(v_meta->'pending') > 0 THEN
    v_body := v_body || jsonb_build_array(jsonb_build_object('type','separator','margin','md'));

    FOR r IN SELECT jsonb_array_elements(v_meta->'signed')
    LOOP
      IF (r->>'status') = 'rejected' THEN
        v_step_text  := '❌ 第' || (r->>'step') || '關 ' || (r->>'name') || ' · ' || COALESCE(r->>'time','');
        v_step_color := '#ef4444';
      ELSE
        v_step_text  := '✅ 第' || (r->>'step') || '關 ' || (r->>'name') || ' · ' || COALESCE(r->>'time','');
        v_step_color := '#374151';
      END IF;
      v_body := v_body || jsonb_build_array(
        jsonb_build_object('type','text','text',v_step_text,'size','xs','color',v_step_color,'wrap',true)
      );
    END LOOP;

    FOR r IN SELECT jsonb_array_elements(v_meta->'pending')
    LOOP
      v_step_text := '⏳ 第' || (r->>'step') || '關 ' || (r->>'name');
      IF p_recipient_approver IS NOT NULL AND (r->>'name') = p_recipient_approver THEN
        v_step_text := v_step_text || ' ← 您';
      END IF;
      v_body := v_body || jsonb_build_array(
        jsonb_build_object('type','text','text',v_step_text,'size','xs','color','#9ca3af','wrap',true)
      );
    END LOOP;
  END IF;

  v_payload := jsonb_build_object(
    'to', p_line_user_id,
    'messages', jsonb_build_array(
      jsonb_build_object(
        'type','flex','altText',v_alt_text,
        'contents', jsonb_build_object(
          'type','bubble','size','mega',
          'header', jsonb_build_object(
            'type','box','layout','vertical','paddingAll','14px','backgroundColor',v_color,
            'contents', jsonb_build_array(
              jsonb_build_object('type','text','text',v_header,'color','#FFFFFF','weight','bold','size','md')
            )
          ),
          'body', jsonb_build_object(
            'type','box','layout','vertical','spacing','sm','paddingAll','14px',
            'contents', v_body
          ),
          'footer', jsonb_build_object(
            'type','box','layout','vertical','spacing','sm','paddingAll','14px',
            'contents', CASE
              WHEN v_liff_url IS NOT NULL THEN jsonb_build_array(
                jsonb_build_object(
                  'type','button','style','primary','color',v_color,'height','sm',
                  'action', jsonb_build_object('type','uri','label',v_btn_label,'uri',v_liff_url)
                )
              )
              ELSE '[]'::jsonb
            END
          )
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
END $$;

GRANT EXECUTE ON FUNCTION public._push_task_chain_flex(text, text, int, text, text, int, int, text, text) TO authenticated, service_role;

COMMIT;
