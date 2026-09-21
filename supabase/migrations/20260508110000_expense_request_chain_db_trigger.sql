-- ════════════════════════════════════════════════════════════
-- expense_requests 簽核鏈 LINE 通知 — 全部走 DB trigger
-- 對齊 task_chain_unified (20260507210000) 的 pattern
--
-- 解決問題：
--   1. AFTER INSERT expense_requests 沒有任何 trigger 推 LINE 給第一關 → 第一關沒收到
--   2. 之前靠前端 createApprovalWorkflow → notifyTaskAssignee(supervisor)
--      但 supervisor (reporting_to) ≠ chain step 0 → 推錯人 / 推不到
--   3. expense_request_step_advance RPC 推進 current_step 也沒推下一關 LINE
--   4. 違反「所有簽核走 DB trigger」鐵律（feedback_signoff_must_use_db_trigger）
--
-- 卡片設計：完全對齊 supabase/functions/line-webhook/flex-builders.ts 的 flexApprovalRequest
--   - header: COLOR_EXPENSE (#ec4899) + 💳 emoji + 「經費申請」label + #id
--   - body: 👤 申請人 + 部門 → separator → 金額/項目/科目 row → 原因 block
--   - footer: ✅ 核准 / ❌ 駁回 (postback) + 📋 看完整詳情 (LIFF)
--   - postback data 對齊 postback-approval.ts:351：action=approve&type=request&rt=expense_request&id=X
--
-- 雙推處理：
--   - 同 transaction 內若已有 SET LOCAL app.skip_chain_notify='true' → 跳過
--   - postback-approval.ts 的 pushCardToApprovers 呼叫要拔掉（同步 commit），讓 trigger 接手
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. helper：推 expense_request flex 卡（對齊 flexApprovalRequest 視覺） ═══
CREATE OR REPLACE FUNCTION public._push_expense_request_flex(
  p_line_user_id text,
  p_liff_id      text,
  p_request_id   int,
  p_event        text         -- 'step_assigned' | 'request_approved' | 'request_rejected'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_push_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon       CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';

  -- ── 對齊 colors.ts ──
  v_header_color CONSTANT text := '#ec4899';   -- COLOR_EXPENSE
  v_subtitle     CONSTANT text := '#FBCFE8';   -- TEXT_DIM_EXPENSE
  v_text_white   CONSTANT text := '#FFFFFF';
  v_text_white_muted CONSTANT text := '#FFFFFFAA';
  v_text_title   CONSTANT text := '#111827';
  v_text_body    CONSTANT text := '#333333';
  v_text_secondary CONSTANT text := '#666666';
  v_text_label   CONSTANT text := '#9CA3AF';
  v_color_success CONSTANT text := '#16a34a';
  v_color_danger  CONSTANT text := '#dc2626';
  v_emoji        CONSTANT text := '💳';
  v_label        CONSTANT text := '經費申請';

  v_req          expense_requests;
  v_dept         text;

  v_status_chip  text;
  v_alt_text     text;
  v_amount_str   text;

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

  -- 部門：先用 dept text，否則 join departments
  IF v_req.department IS NOT NULL AND v_req.department <> '' THEN
    v_dept := v_req.department;
  ELSE
    SELECT d.name INTO v_dept
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.id = v_req.employee_id;
  END IF;

  v_amount_str := 'NT$ ' || to_char(COALESCE(v_req.estimated_amount, 0), 'FM999,999,999,999');

  -- status chip + alt text by event
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

  -- ── body 申請人 block（dept 有值才加） ──
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
    -- 金額（依 event 著色）
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
    -- 項目
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

  -- ── 原因 / 退回原因 block（淺底 box） ──
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

  -- 把 reason block 接到 rows
  v_rows := v_rows || v_reason_block;

  v_body := jsonb_build_object(
    'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '16px',
    'contents', v_rows
  );

  -- ── footer 按鈕 ──
  -- LIFF deeplink → /approve?type=expense_request&id=X
  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
                  || '?to=%2Fapprove%3Ftype%3Dexpense_request%26id%3D' || p_request_id::text;
  END IF;

  -- step_assigned: 兩 postback + LIFF 詳情
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
    -- approved/rejected：只有 LIFF 詳情按鈕（不需要再簽）
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

  -- 非同步 fire；pg_net 不會 block transaction
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


-- ═══ 2. helper：對 expense_request 第 N 關推 LINE 給「該關所有 approvers」═══
CREATE OR REPLACE FUNCTION public._notify_expense_request_step(
  p_request_id  int,
  p_step_order  int
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req         expense_requests;
  v_step        approval_chain_steps;
  v_count       int := 0;
  v_line        record;
BEGIN
  SELECT * INTO v_req FROM expense_requests WHERE id = p_request_id;
  IF v_req.id IS NULL OR v_req.approval_chain_id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO v_step
    FROM approval_chain_steps
   WHERE chain_id = v_req.approval_chain_id AND step_order = p_step_order;
  IF v_step.id IS NULL THEN RETURN 0; END IF;

  -- 用 resolve_chain_step_approvers (10 種 target_type 都吃) → JOIN line view 拿 liff_id
  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
      FROM resolve_chain_step_approvers(v_step.id, v_req.employee_id) a
      JOIN v_employee_line_resolved v ON v.employee_id = a.emp_id
                                     AND v.line_user_id = a.line_user_id
     WHERE v.line_user_id IS NOT NULL
  LOOP
    PERFORM public._push_expense_request_flex(
      v_line.line_user_id, v_line.liff_id, v_req.id, 'step_assigned'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public._notify_expense_request_step(int, int) TO authenticated, service_role;


-- ═══ 3. AFTER INSERT trigger on expense_requests → 推第一關 LINE ═══
CREATE OR REPLACE FUNCTION public._trg_notify_expense_request_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('申請中', '待審') THEN RETURN NEW; END IF;
  IF NEW.approval_chain_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public._notify_expense_request_step(NEW.id, COALESCE(NEW.current_step, 0));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_expense_request_inserted ON public.expense_requests;
CREATE TRIGGER trg_notify_expense_request_inserted
  AFTER INSERT ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_expense_request_inserted();


-- ═══ 4. AFTER UPDATE trigger → 推下一關 / 推結果 ═══
CREATE OR REPLACE FUNCTION public._trg_notify_expense_request_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_app_line text;
  v_app_liff text;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  -- 已核准 → 推申請人
  IF NEW.status = '已核准' AND OLD.status IS DISTINCT FROM '已核准' THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v
     WHERE v.employee_id = NEW.employee_id
     ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
     LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_expense_request_flex(v_app_line, v_app_liff, NEW.id, 'request_approved');
    END IF;
    RETURN NEW;
  END IF;

  -- 已駁回 → 推申請人 + reason
  IF NEW.status = '已駁回' AND OLD.status IS DISTINCT FROM '已駁回' THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v
     WHERE v.employee_id = NEW.employee_id
     ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
     LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_expense_request_flex(v_app_line, v_app_liff, NEW.id, 'request_rejected');
    END IF;
    RETURN NEW;
  END IF;

  -- current_step 推進到下一關（status 還是申請中）→ 推下一關 approver
  IF NEW.current_step > COALESCE(OLD.current_step, 0)
     AND NEW.status IN ('申請中', '待審')
     AND NEW.approval_chain_id IS NOT NULL THEN
    PERFORM public._notify_expense_request_step(NEW.id, NEW.current_step);
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_expense_request_updated ON public.expense_requests;
CREATE TRIGGER trg_notify_expense_request_updated
  AFTER UPDATE ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_expense_request_updated();


COMMIT;

NOTIFY pgrst, 'reload schema';
