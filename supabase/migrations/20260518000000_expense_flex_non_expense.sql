-- ════════════════════════════════════════════════════════════════════════════
-- 修 _push_expense_request_flex：支援「非費用申請」(is_expense=false)
--
-- 場景：永春店「新增 10 隻紅酒」這種調貨單，提費用申請流程但實際 NT$ 0 / 沒科目。
-- 之前卡片硬顯示「💳 經費申請 / 金額 NT$ 0 / 科目 — / 門市 —」很怪。
--
-- 修法：
--   - is_expense = false 時：
--     * 標籤改「📋 非費用申請」（紫色 header 區隔，跟費用粉色不一樣）
--     * 金額 row 不顯示（NT$ 0 沒意義）
--     * 科目 row 不顯示（沒有會計科目）
--     * alt text 改成「非費用申請」
--   - is_expense = true / null 時：維持原樣（粉紅 / 顯示金額）
--
-- 對齊 20260511160000 carousel 版本
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._push_expense_request_flex(
  p_line_user_id text,
  p_liff_id      text,
  p_request_id   int,
  p_event        text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_push_url    CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon        CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
  v_storage_base CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/storage/v1/object/public/';

  -- 共用色票
  v_subtitle          CONSTANT text := '#FBCFE8';
  v_subtitle_purple   CONSTANT text := '#E9D5FF';  -- 非費用用紫色 subtitle
  v_text_white        CONSTANT text := '#FFFFFF';
  v_text_white_muted  CONSTANT text := '#FFFFFFAA';
  v_text_title        CONSTANT text := '#111827';
  v_text_body         CONSTANT text := '#333333';
  v_text_secondary    CONSTANT text := '#666666';
  v_text_label        CONSTANT text := '#9CA3AF';
  v_color_success     CONSTANT text := '#16a34a';
  v_color_danger      CONSTANT text := '#dc2626';

  -- 依 is_expense 切換的視覺
  v_header_color      text;
  v_emoji             text;
  v_label             text;
  v_subtitle_color    text;
  v_is_non_expense    boolean;

  v_req               expense_requests;
  v_dept              text;
  v_amount_str        text;
  v_status_chip       text;
  v_alt_text          text;
  v_liff_url          text;
  v_postback_approve  text;
  v_postback_reject   text;

  v_header            jsonb;
  v_body              jsonb;
  v_footer            jsonb;
  v_rows              jsonb := '[]'::jsonb;
  v_reason_block      jsonb := '[]'::jsonb;
  v_att_block         jsonb := '[]'::jsonb;
  v_footer_buttons    jsonb := '[]'::jsonb;
  v_applicant_inner   jsonb;
  v_att_rec           record;

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

  -- ★ 偵測非費用申請 + 切換視覺
  v_is_non_expense := v_req.is_expense IS FALSE;
  IF v_is_non_expense THEN
    v_header_color   := '#a855f7';  -- 紫色（區隔費用申請的粉色）
    v_emoji          := '📋';
    v_label          := '非費用申請';
    v_subtitle_color := v_subtitle_purple;
  ELSE
    v_header_color   := '#ec4899';
    v_emoji          := '💳';
    v_label          := '經費申請';
    v_subtitle_color := v_subtitle;
  END IF;

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
    v_alt_text := v_emoji || ' ' || v_label || '已通過 — ' || COALESCE(v_req.title, '');
  ELSIF p_event = 'request_rejected' THEN
    v_status_chip := '已退回';
    v_alt_text := v_emoji || ' ' || v_label || '被退回 — ' || COALESCE(v_req.title, '');
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
        'color', v_subtitle_color, 'size', 'xs', 'margin', 'xs')
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

  -- ★ 金額 row：只在費用申請時顯示（非費用 = NT$ 0 沒意義）
  IF NOT v_is_non_expense THEN
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
      )
    );
  END IF;

  -- 項目 row：兩種都顯示
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

  -- ★ 科目 row：只在費用申請時顯示
  IF NOT v_is_non_expense AND v_req.account_code IS NOT NULL AND v_req.account_code <> '' THEN
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

  -- 門市 row：兩種都顯示（如果有）
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

  -- ── 退回原因 / 申請說明 block ──
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

  -- ── 附件 block ──
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
                  || '?to=%2Fapprove%2Fexpense-request%3Fid%3D' || p_request_id::text;
  END IF;

  IF p_event = 'step_assigned' THEN
    v_postback_approve := 'action=approve&type=request&rt=expense_request&id=' || p_request_id;
    v_postback_reject  := 'action=reject&type=request&rt=expense_request&id=' || p_request_id;

    -- 第一排：核准 + 駁回（horizontal）
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

    -- 第二排：🪶 加簽 + 📋 看詳情（horizontal）
    IF v_liff_url IS NOT NULL THEN
      v_footer_buttons := v_footer_buttons || jsonb_build_array(
        jsonb_build_object(
          'type','box','layout','horizontal','spacing','sm',
          'contents', jsonb_build_array(
            jsonb_build_object(
              'type','button',
              -- LIFF 連結帶 openAddSigner=1 讓 LIFF 自動打開加簽表單
              'action', jsonb_build_object('type','uri','label','🪶 加簽','uri', v_liff_url || '%26openAddSigner%3D1'),
              'style','secondary','color','#f97316','height','sm','flex',1
            ),
            jsonb_build_object(
              'type','button',
              'action', jsonb_build_object('type','uri','label','📋 看詳情','uri', v_liff_url),
              'style','secondary','height','sm','flex',1
            )
          )
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

  -- ── 第二卡：費用明細 ──
  -- ★ 非費用申請不顯示第二卡（沒會計概念）
  IF NOT v_is_non_expense AND (
    (v_req.supplier IS NOT NULL AND v_req.supplier <> '')
    OR (v_req.items IS NOT NULL AND jsonb_array_length(v_req.items) > 0)
  ) THEN
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
            'color', v_subtitle_color, 'size','xs','margin','xs')
        )
      ),
      'body', jsonb_build_object(
        'type','box','layout','vertical','spacing','sm','paddingAll','16px',
        'contents', v_items_rows
      )
    );
  END IF;

  -- ── Payload ──
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
END
$$;

GRANT EXECUTE ON FUNCTION public._push_expense_request_flex(text, text, int, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
