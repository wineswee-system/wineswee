-- ════════════════════════════════════════════════════════════
-- expense_request flex v2
--   • 第一卡：附件區塊（📎 附件）含可點連結，接在申請說明後
--   • 第二卡：費用明細（供應商 + 品項/數量/小記 + 合計）
--   • 有明細 or 供應商 → 改用 carousel；否則維持單 bubble
-- ════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._push_expense_request_flex(
  p_line_user_id text,
  p_liff_id      text,
  p_request_id   int,
  p_event        text   -- 'step_assigned' | 'request_approved' | 'request_rejected'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_push_url    CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon        CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_storage_base CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/storage/v1/object/public/';

  -- ── colors (aligned with colors.ts) ──
  v_header_color      CONSTANT text := '#ec4899';
  v_subtitle          CONSTANT text := '#FBCFE8';
  v_text_white        CONSTANT text := '#FFFFFF';
  v_text_white_muted  CONSTANT text := '#FFFFFFAA';
  v_text_title        CONSTANT text := '#111827';
  v_text_body         CONSTANT text := '#333333';
  v_text_secondary    CONSTANT text := '#666666';
  v_text_label        CONSTANT text := '#9CA3AF';
  v_color_success     CONSTANT text := '#16a34a';
  v_color_danger      CONSTANT text := '#dc2626';
  v_emoji             CONSTANT text := '💳';
  v_label             CONSTANT text := '經費申請';

  v_req               expense_requests;
  v_dept              text;
  v_amount_str        text;
  v_status_chip       text;
  v_alt_text          text;
  v_liff_url          text;
  v_postback_approve  text;
  v_postback_reject   text;

  -- card 1
  v_header            jsonb;
  v_body              jsonb;
  v_footer            jsonb;
  v_rows              jsonb := '[]'::jsonb;
  v_reason_block      jsonb := '[]'::jsonb;
  v_att_block         jsonb := '[]'::jsonb;
  v_footer_buttons    jsonb := '[]'::jsonb;
  v_applicant_inner   jsonb;
  v_att_rec           record;

  -- card 2 (items)
  v_bubble1           jsonb;
  v_bubble2           jsonb;
  v_items_rows        jsonb := '[]'::jsonb;
  v_item_elem         jsonb;
  v_item_total        numeric := 0;
  v_item_name         text;
  v_item_qty          text;
  v_item_sub          text;

  v_payload           jsonb;
BEGIN
  IF p_line_user_id IS NULL OR p_line_user_id = '' THEN RETURN; END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = p_request_id;
  IF v_req.id IS NULL THEN RETURN; END IF;

  -- department
  IF v_req.department IS NOT NULL AND v_req.department <> '' THEN
    v_dept := v_req.department;
  ELSE
    SELECT d.name INTO v_dept
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.id = v_req.employee_id;
  END IF;

  v_amount_str := 'NT$ ' || to_char(COALESCE(v_req.estimated_amount, 0), 'FM999,999,999,999');

  -- status chip + alt text
  IF p_event = 'request_approved' THEN
    v_status_chip := '已核准';
    v_alt_text := v_emoji || ' 申請已通過 — ' || COALESCE(v_req.title, '');
  ELSIF p_event = 'request_rejected' THEN
    v_status_chip := '已退回';
    v_alt_text := v_emoji || ' 申請被退回 — ' || COALESCE(v_req.title, '');
  ELSE
    v_status_chip := '待你審核';
    v_alt_text := v_emoji || ' ' || v_label || ' — ' || COALESCE(v_req.employee, '');
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
      jsonb_build_object('type','text','text', '#' || p_request_id,
        'color', v_subtitle, 'size', 'xs', 'margin', 'xs')
    )
  );

  -- ── body: 申請人 block ──
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

  -- ── 欄位列：金額 / 項目 / 科目 / 門市 ──
  v_rows := v_rows || jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','金額','size','sm','color', v_text_label,'flex',2),
        jsonb_build_object('type','text','text', v_amount_str,'size','sm','weight','bold',
          'color', CASE p_event
                     WHEN 'request_approved' THEN v_color_success
                     WHEN 'request_rejected' THEN v_color_danger
                     ELSE v_text_body END,
          'flex', 5, 'wrap', true)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','項目','size','sm','color', v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_req.title, '—'),
          'size','sm','color', v_text_body, 'flex', 5, 'wrap', true)
      )
    )
  );

  IF v_req.account_code IS NOT NULL AND v_req.account_code <> '' THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','科目','size','sm','color', v_text_label,'flex',2),
          jsonb_build_object('type','text','text',
            v_req.account_code || COALESCE(' ' || v_req.account_name, ''),
            'size','sm','color', v_text_body, 'flex', 5, 'wrap', true)
        )
      )
    );
  END IF;

  IF v_req.store IS NOT NULL AND v_req.store <> '' THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','門市','size','sm','color', v_text_label,'flex',2),
          jsonb_build_object('type','text','text', v_req.store,
            'size','sm','color', v_text_body, 'flex', 5, 'wrap', true)
        )
      )
    );
  END IF;

  -- ── 原因 / 退回原因 / 申請說明 block ──
  IF p_event = 'request_rejected' AND v_req.reject_reason IS NOT NULL AND btrim(v_req.reject_reason) <> '' THEN
    v_reason_block := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FEF2F2','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','❌ 退回原因','size','xxs','color', v_color_danger,'weight','bold'),
          jsonb_build_object('type','text','text', v_req.reject_reason,
            'size','sm','color', v_text_body, 'wrap', true, 'margin', 'sm')
        )
      )
    );
  ELSIF v_req.description IS NOT NULL AND btrim(v_req.description) <> '' THEN
    v_reason_block := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F9FAFB','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 申請說明','size','xxs','color', v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_req.description,
            'size','sm','color', v_text_body, 'wrap', true, 'margin', 'sm')
        )
      )
    );
  END IF;

  v_rows := v_rows || v_reason_block;

  -- ── 附件 block（接在申請說明後，最多 5 筆） ──
  FOR v_att_rec IN
    SELECT file_name, storage_path
      FROM expense_request_attachments
     WHERE request_id = p_request_id
     ORDER BY created_at
     LIMIT 5
  LOOP
    v_att_block := v_att_block || jsonb_build_array(
      jsonb_build_object(
        'type',       'text',
        'text',       '📎 ' || v_att_rec.file_name,
        'size',       'sm',
        'color',      '#2563EB',
        'decoration', 'underline',
        'wrap',       true,
        'margin',     'xs',
        'action',     jsonb_build_object(
                        'type',  'uri',
                        'label', v_att_rec.file_name,
                        'uri',   v_storage_base || v_att_rec.storage_path
                      )
      )
    );
  END LOOP;

  IF jsonb_array_length(v_att_block) > 0 THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#EFF6FF','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📎 附件',
            'size','xxs','color','#1D4ED8','weight','bold','margin','none')
        ) || v_att_block
      )
    );
  END IF;

  v_body := jsonb_build_object(
    'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '16px',
    'contents', v_rows
  );

  -- ── footer 按鈕 ──
  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
                  || '?to=%2Fapprove%3Ftype%3Dexpense_request%26id%3D' || p_request_id::text;
  END IF;

  IF p_event = 'step_assigned' THEN
    v_postback_approve := 'action=approve&type=request&rt=expense_request&id=' || p_request_id;
    v_postback_reject  := 'action=reject&type=request&rt=expense_request&id=' || p_request_id;

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

  -- ════════════════════════════════════
  -- 第二卡：費用明細（供應商 + 品項 + 合計）
  -- ════════════════════════════════════
  IF (v_req.supplier IS NOT NULL AND v_req.supplier <> '')
     OR (v_req.items IS NOT NULL AND jsonb_array_length(v_req.items) > 0)
  THEN
    -- 供應商 row
    IF v_req.supplier IS NOT NULL AND v_req.supplier <> '' THEN
      v_items_rows := v_items_rows || jsonb_build_array(
        jsonb_build_object(
          'type','box','layout','horizontal','margin','sm',
          'contents', jsonb_build_array(
            jsonb_build_object('type','text','text','供應商','size','sm','color', v_text_label,'flex',3),
            jsonb_build_object('type','text','text', v_req.supplier,
              'size','sm','color', v_text_body, 'flex',7, 'wrap', true)
          )
        ),
        jsonb_build_object('type','separator','margin','md')
      );
    END IF;

    -- 欄位標題 + 品項 rows（只有 items 非空時才顯示）
    IF v_req.items IS NOT NULL AND jsonb_array_length(v_req.items) > 0 THEN
      v_items_rows := v_items_rows || jsonb_build_array(
        jsonb_build_object(
          'type','box','layout','horizontal','margin','sm',
          'contents', jsonb_build_array(
            jsonb_build_object('type','text','text','品項','size','xs','color', v_text_label,
              'flex',5,'weight','bold'),
            jsonb_build_object('type','text','text','數量','size','xs','color', v_text_label,
              'flex',2,'align','center','weight','bold'),
            jsonb_build_object('type','text','text','小記','size','xs','color', v_text_label,
              'flex',3,'align','end','weight','bold')
          )
        )
      );

      FOR v_item_elem IN
        SELECT value FROM jsonb_array_elements(v_req.items)
      LOOP
        v_item_name  := COALESCE(v_item_elem->>'name', '—');
        v_item_qty   := COALESCE(v_item_elem->>'qty', '—');
        v_item_sub   := 'NT$ ' || to_char(COALESCE((v_item_elem->>'subtotal')::numeric, 0), 'FM999,999,999,999');
        v_item_total := v_item_total + COALESCE((v_item_elem->>'subtotal')::numeric, 0);

        v_items_rows := v_items_rows || jsonb_build_array(
          jsonb_build_object(
            'type','box','layout','horizontal','margin','xs',
            'contents', jsonb_build_array(
              jsonb_build_object('type','text','text', v_item_name,
                'size','sm','color', v_text_body, 'flex',5, 'wrap', true),
              jsonb_build_object('type','text','text', v_item_qty,
                'size','sm','color', v_text_secondary, 'flex',2, 'align','center'),
              jsonb_build_object('type','text','text', v_item_sub,
                'size','sm','color', v_text_body, 'flex',3, 'align','end')
            )
          )
        );
      END LOOP;

      -- 合計 row
      v_items_rows := v_items_rows || jsonb_build_array(
        jsonb_build_object('type','separator','margin','md'),
        jsonb_build_object(
          'type','box','layout','horizontal','margin','sm',
          'contents', jsonb_build_array(
            jsonb_build_object('type','text','text','合計',
              'size','sm','color', v_text_body, 'flex',7, 'weight','bold'),
            jsonb_build_object('type','text','text',
              'NT$ ' || to_char(v_item_total, 'FM999,999,999,999'),
              'size','sm','weight','bold',
              'color', CASE p_event
                         WHEN 'request_approved' THEN v_color_success
                         WHEN 'request_rejected' THEN v_color_danger
                         ELSE v_text_body END,
              'flex',5, 'align','end')
          )
        )
      );
    END IF;

    v_bubble2 := jsonb_build_object(
      'type', 'bubble', 'size', 'kilo',
      'header', jsonb_build_object(
        'type','box','layout','vertical','paddingAll','16px',
        'backgroundColor', v_header_color,
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text', v_emoji || ' 費用明細',
            'color', v_text_white, 'weight','bold','size','lg'),
          jsonb_build_object('type','text','text', '#' || p_request_id,
            'color', v_subtitle, 'size','xs','margin','xs')
        )
      ),
      'body', jsonb_build_object(
        'type','box','layout','vertical','spacing','sm','paddingAll','16px',
        'contents', v_items_rows
      )
    );
  END IF;

  -- ════════════════════════════════════
  -- Payload: carousel if bubble2 exists, else single bubble
  -- ════════════════════════════════════
  v_bubble1 := jsonb_build_object(
    'type', 'bubble', 'size', 'kilo',
    'header', v_header,
    'body',   v_body,
    'footer', v_footer
  );

  IF v_bubble2 IS NOT NULL THEN
    v_payload := jsonb_build_object(
      'to', p_line_user_id,
      'messages', jsonb_build_array(
        jsonb_build_object(
          'type',     'flex',
          'altText',  v_alt_text,
          'contents', jsonb_build_object(
            'type',     'carousel',
            'contents', jsonb_build_array(v_bubble1, v_bubble2)
          )
        )
      )
    );
  ELSE
    v_payload := jsonb_build_object(
      'to', p_line_user_id,
      'messages', jsonb_build_array(
        jsonb_build_object(
          'type',     'flex',
          'altText',  v_alt_text,
          'contents', v_bubble1
        )
      )
    );
  END IF;

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

GRANT EXECUTE ON FUNCTION public._push_expense_request_flex(text, text, int, text)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
