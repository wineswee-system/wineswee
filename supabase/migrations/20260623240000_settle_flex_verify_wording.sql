-- ════════════════════════════════════════════════════════════════════════════
-- 費用核銷 LINE 卡片文字調整：標題「費用核銷」→「費用核銷(驗收)」、右側「待你審核」→「待你驗收」
-- 2026-06-23
-- 以 live _push_expense_settle_flex 全文為底，只改 v_label 與待審核 v_status_chip 兩個字串。
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._push_expense_settle_flex(p_line_user_id text, p_liff_id text, p_request_id integer, p_event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_push_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon       CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';

  v_header_color CONSTANT text := '#06b6d4';   -- COLOR_SETTLE (cyan，跟 expense 申請 pink 區分)
  v_subtitle     CONSTANT text := '#A5F3FC';
  v_text_white   CONSTANT text := '#FFFFFF';
  v_text_white_muted CONSTANT text := '#FFFFFFAA';
  v_text_title   CONSTANT text := '#111827';
  v_text_body    CONSTANT text := '#333333';
  v_text_secondary CONSTANT text := '#666666';
  v_text_label   CONSTANT text := '#9CA3AF';
  v_color_success CONSTANT text := '#16a34a';
  v_color_danger  CONSTANT text := '#dc2626';
  v_emoji        CONSTANT text := '🧾';
  v_label        CONSTANT text := '費用核銷(驗收)';

  v_req          expense_requests;
  v_dept         text;

  -- ★ 動態幣別：符號 + 數字格式（讀 expense_requests.currency）
  v_currency_sym text;
  v_currency_fmt text;

  v_status_chip  text;
  v_alt_text     text;
  v_amount_str   text;
  v_est_str      text;
  v_diff_str     text;

  v_liff_url     text;
  v_postback_approve text;
  v_postback_reject  text;

  v_header       jsonb;
  v_body         jsonb;
  v_footer       jsonb;
  v_payload      jsonb;
  v_rows         jsonb := '[]'::jsonb;
  v_reason_block jsonb := '[]'::jsonb;
  v_footer_buttons jsonb := '[]'::jsonb;
  v_applicant_inner jsonb;
BEGIN
  IF p_line_user_id IS NULL OR p_line_user_id = '' THEN RETURN; END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RETURN; END IF;

  IF v_req.department IS NOT NULL AND v_req.department <> '' THEN
    v_dept := v_req.department;
  ELSE
    SELECT d.name INTO v_dept
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.id = v_req.employee_id;
  END IF;

  -- ★ 幣別符號與數字格式（讀 expense_requests.currency）
  --   TWD → 'NT$ '  整數格式 FM999,999,999,999
  --   JPY → '¥ '   整數格式 FM999,999,999,999
  --   USD → 'US$ ' 兩位小數 FM999,999,999,990.00
  --   EUR → '€ '   兩位小數 FM999,999,999,990.00
  --   CNY → '¥ '   兩位小數 FM999,999,999,990.00
  v_currency_sym := COALESCE((SELECT c.symbol || ' ' FROM public.currencies c WHERE c.code = COALESCE(v_req.currency, 'TWD')), 'NT$ ');
  v_currency_fmt := COALESCE((SELECT CASE WHEN c.decimals > 0 THEN 'FM999,999,999,990.00' ELSE 'FM999,999,999,999' END FROM public.currencies c WHERE c.code = COALESCE(v_req.currency, 'TWD')), 'FM999,999,999,999');

  v_amount_str := v_currency_sym || to_char(COALESCE(v_req.actual_amount, 0), v_currency_fmt);
  v_est_str    := v_currency_sym || to_char(COALESCE(v_req.estimated_amount, 0), v_currency_fmt);
  IF v_req.actual_amount IS NOT NULL AND v_req.estimated_amount IS NOT NULL THEN
    -- 差額保持原視覺（+/-1,234），不加幣別前綴；但 format 跟 currency 同步（USD/EUR 需小數）
    v_diff_str := CASE
      WHEN v_req.actual_amount > v_req.estimated_amount THEN '+'
      ELSE ''
    END || to_char(v_req.actual_amount - v_req.estimated_amount, v_currency_fmt);
  END IF;

  IF p_event = 'settle_approved' THEN
    v_status_chip := '已核銷';
    v_alt_text := v_emoji || ' 核銷已通過 — ' || COALESCE(v_req.title, '');
  ELSIF p_event = 'settle_rejected' THEN
    v_status_chip := '核銷已退回';
    v_alt_text := v_emoji || ' 核銷被退回 — ' || COALESCE(v_req.title, '');
  ELSE
    v_status_chip := '待你驗收';
    v_alt_text := v_emoji || ' ' || v_label || ' — ' || COALESCE(v_req.employee, '');
  END IF;

  -- header
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
      jsonb_build_object('type','text','text', '#' || p_request_id,
        'color', v_subtitle, 'size', 'xs', 'margin', 'xs')
    )
  );

  -- body
  v_applicant_inner := jsonb_build_array(
    jsonb_build_object('type','text','text', COALESCE(v_req.employee, ''),
      'weight','bold','size','md','color', v_text_title)
  );
  IF v_dept IS NOT NULL AND v_dept <> '' THEN
    v_applicant_inner := v_applicant_inner || jsonb_build_array(
      jsonb_build_object('type','text','text', v_dept,
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

  -- 實際金額 / 申請金額 / 差額 / 項目
  v_rows := v_rows || jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','實際','size','sm','color', v_text_label,'flex',2),
        jsonb_build_object('type','text','text', v_amount_str,'size','sm','weight','bold',
          'color', CASE p_event
                     WHEN 'settle_approved' THEN v_color_success
                     WHEN 'settle_rejected' THEN v_color_danger
                     ELSE v_text_body END,
          'flex', 5, 'wrap', true)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','申請','size','sm','color', v_text_label,'flex',2),
        jsonb_build_object('type','text','text', v_est_str,'size','sm','color', v_text_body, 'flex', 5, 'wrap', true)
      )
    )
  );

  IF v_diff_str IS NOT NULL THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','差額','size','sm','color', v_text_label,'flex',2),
          jsonb_build_object('type','text','text', v_diff_str,'size','sm','weight','bold',
            'color', CASE
              WHEN v_req.actual_amount > v_req.estimated_amount THEN v_color_danger
              WHEN v_req.actual_amount < v_req.estimated_amount THEN v_color_success
              ELSE v_text_body
            END,
            'flex', 5, 'wrap', true)
        )
      )
    );
  END IF;

  v_rows := v_rows || jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','項目','size','sm','color', v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_req.title, '—'),
          'size','sm','color', v_text_body, 'flex', 5, 'wrap', true)
      )
    )
  );

  -- 退回原因 / 核銷說明 block
  IF p_event = 'settle_rejected' AND v_req.settle_reject_reason IS NOT NULL AND btrim(v_req.settle_reject_reason) <> '' THEN
    v_reason_block := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FEF2F2','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','❌ 退回原因','size','xxs','color', v_color_danger,'weight','bold'),
          jsonb_build_object('type','text','text', v_req.settle_reject_reason,
            'size','sm','color', v_text_body, 'wrap', true, 'margin', 'sm')
        )
      )
    );
  ELSIF v_req.notes IS NOT NULL AND btrim(v_req.notes) <> '' THEN
    v_reason_block := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F9FAFB','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 核銷說明','size','xxs','color', v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_req.notes,
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

  -- footer
  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
                  || '?to=%2Fapprove%3Ftype%3Dexpense_settle%26id%3D' || p_request_id::text;
  END IF;

  IF p_event = 'settle_assigned' THEN
    v_postback_approve := 'action=approve&type=request&rt=expense_settle&id=' || p_request_id;
    v_postback_reject  := 'action=reject&type=request&rt=expense_settle&id=' || p_request_id;

    v_footer_buttons := jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','spacing','sm',
        'contents', jsonb_build_array(
          jsonb_build_object(
            'type','button',
            'action', jsonb_build_object('type','postback','label','✅ 核准','data', v_postback_approve),
            'style','primary','color', v_color_success,'height','sm','flex',1
          ),
          jsonb_build_object(
            'type','button',
            'action', jsonb_build_object('type','postback','label','❌ 駁回','data', v_postback_reject),
            'style','primary','color', v_color_danger,'height','sm','flex',1
          )
        )
      )
    );

    IF v_liff_url IS NOT NULL THEN
      v_footer_buttons := v_footer_buttons || jsonb_build_array(
        jsonb_build_object(
          'type','button',
          'action', jsonb_build_object('type','uri','label','📋 看完整詳情','uri', v_liff_url),
          'style','secondary','height','sm'
        )
      );
    END IF;
  ELSE
    IF v_liff_url IS NOT NULL THEN
      v_footer_buttons := jsonb_build_array(
        jsonb_build_object(
          'type','button',
          'action', jsonb_build_object('type','uri','label','📋 查看詳情','uri', v_liff_url),
          'style','secondary','height','sm'
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

