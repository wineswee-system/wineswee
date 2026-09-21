-- 加簽卡片/我的簽核：補「自訂表單 / 報帳」中文標籤 — 2026-07-08
-- 卡片本來就會送(generic flex),只是 form_submissions/expenses 沒在 label CASE → 顯示英文 raw。
-- dump live 後僅在 store_audits 那行後追加 WHEN，idempotent。

CREATE OR REPLACE FUNCTION public._push_extra_signer_generic_flex(p_line_user_id text, p_liff_id text, p_extra_id integer, p_event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_push_url CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon     CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
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
END $function$;

CREATE OR REPLACE FUNCTION public.web_list_my_extra_assignments()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  emp employees;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::json; END IF;
  SELECT * INTO emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF emp.id IS NULL THEN RETURN '[]'::json; END IF;

  RETURN COALESCE((
    SELECT json_agg(t)
    FROM (
      SELECT e.id, e.source_table, e.source_id, e.insert_before_step,
             e.reason, e.created_at,
             er.name AS requester_name,
             CASE e.source_table
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
               WHEN 'expenses' THEN '報帳'
               WHEN 'expense_requests' THEN '費用/核銷'
               WHEN 'form_submissions' THEN '自訂表單'
               ELSE e.source_table
             END AS form_label
      FROM approval_extra_steps e
      LEFT JOIN employees er ON er.id = e.requested_by_id
      WHERE e.assignee_id = emp.id AND e.status = 'pending'
      ORDER BY e.created_at DESC
    ) t
  ), '[]'::json);
END $function$;

NOTIFY pgrst, 'reload schema';

-- 保險：CREATE OR REPLACE 本就保留 grant，這裡再明確一次
GRANT EXECUTE ON FUNCTION public._push_extra_signer_generic_flex(text, text, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.web_list_my_extra_assignments() TO authenticated;
