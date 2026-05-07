-- ============================================================
-- 修 _push_task_chain_flex 的 LIFF deep-link：
-- step_assigned 應該導向 /task-confirmations（簽核者待辦清單）
-- task_done / task_rejected 導向 /tasks?task=ID（任務負責人查狀態）
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._push_task_chain_flex(
  p_line_user_id text,
  p_liff_id      text,
  p_task_id      int,
  p_task_title   text,
  p_step_label   text,
  p_step_order   int,
  p_chain_total  int,
  p_event        text     -- 'step_assigned' | 'task_done' | 'task_rejected'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_push_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon       CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_liff_url   text;
  v_color      text;
  v_header     text;
  v_alt_text   text;
  v_btn_label  text;
  v_payload    jsonb;
BEGIN
  IF p_line_user_id IS NULL OR p_line_user_id = '' THEN RETURN; END IF;

  -- by event：顏色 / 標題 / 按鈕標籤 / LIFF 內頁路徑
  IF p_event = 'task_done' THEN
    v_color := '#22c55e';
    v_header := '✅ 簽核完成';
    v_alt_text := '簽核完成：' || COALESCE(p_task_title, '');
    v_btn_label := '🔍 查看任務';
    IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
      v_liff_url := 'https://liff.line.me/' || p_liff_id
                    || '?to=%2Ftasks%3Ftask%3D' || p_task_id::text;
    END IF;
  ELSIF p_event = 'task_rejected' THEN
    v_color := '#ef4444';
    v_header := '❌ 簽核退回';
    v_alt_text := '簽核退回：' || COALESCE(p_task_title, '');
    v_btn_label := '🔍 查看任務';
    IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
      v_liff_url := 'https://liff.line.me/' || p_liff_id
                    || '?to=%2Ftasks%3Ftask%3D' || p_task_id::text;
    END IF;
  ELSE  -- step_assigned
    v_color := '#06b6d4';
    v_header := '🔐 待您簽核';
    v_alt_text := '待簽核：' || COALESCE(p_task_title, '');
    v_btn_label := '✔️ 前往簽核';
    IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
      v_liff_url := 'https://liff.line.me/' || p_liff_id || '?to=%2Ftask-confirmations';
    END IF;
  END IF;

  v_payload := jsonb_build_object(
    'to', p_line_user_id,
    'messages', jsonb_build_array(
      jsonb_build_object(
        'type', 'flex',
        'altText', v_alt_text,
        'contents', jsonb_build_object(
          'type', 'bubble', 'size', 'kilo',
          'header', jsonb_build_object(
            'type', 'box', 'layout', 'vertical',
            'paddingAll', '14px', 'backgroundColor', v_color,
            'contents', jsonb_build_array(
              jsonb_build_object('type','text','text',v_header,'color','#FFFFFF','weight','bold','size','md')
            )
          ),
          'body', jsonb_build_object(
            'type', 'box', 'layout', 'vertical',
            'spacing', 'sm', 'paddingAll', '14px',
            'contents', jsonb_build_array(
              jsonb_build_object('type','text','text',COALESCE(p_task_title,''),'weight','bold','size','md','wrap',true),
              CASE
                WHEN p_event = 'step_assigned' AND p_chain_total IS NOT NULL THEN
                  jsonb_build_object('type','text','text',COALESCE(p_step_label,'') || ' (' || (p_step_order + 1) || '/' || p_chain_total || ')','size','xs','color','#666666','wrap',true)
                WHEN p_event = 'step_assigned' THEN
                  jsonb_build_object('type','text','text',COALESCE(p_step_label,''),'size','xs','color','#666666','wrap',true)
                WHEN p_event = 'task_done' THEN
                  jsonb_build_object('type','text','text','所有簽核關卡已通過','size','xs','color','#666666')
                ELSE
                  jsonb_build_object('type','text','text','簽核已退回，任務退回進行中','size','xs','color','#666666')
              END
            )
          ),
          'footer', jsonb_build_object(
            'type', 'box', 'layout', 'vertical',
            'spacing', 'sm', 'paddingAll', '14px',
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
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    timeout_milliseconds := 8000
  );
END $$;

COMMIT;
