-- ════════════════════════════════════════════════════════════════════════════
-- 加簽功能 P2 — 接 expense_request chain 端到端整合
--
-- P1 已有 schema + 3 RPC + lookup function。
-- P2 接 expense_request 一條 chain，把 LINE push + source row 同步補上：
--
--   1. _push_extra_signer_expense_flex  — 加簽請求專用 LINE flex
--   2. _notify_extra_signer              — 對 assignee 推 LINE
--   3. AFTER INSERT ON approval_extra_steps — 自動推 LINE 給加簽人
--   4. AFTER UPDATE ON approval_extra_steps — 處理 4 種 status transition：
--        pending → approved   推 LINE 回原當前簽核者「請繼續簽核」
--        pending → rejected   更新 expense_requests.status='已駁回' + reject_reason
--                              （現有 trg_notify_expense_request_updated 會自動推 applicant）
--                              額外推給原當前簽核者「已被加簽人退回」
--        pending → cancelled  推 LINE 給加簽人「已撤銷」
--   5. expense_request_step_advance     — 加 guard：有 pending extra 不准推進
--
-- 對齊規範：
--   - 完全 mirror _push_expense_request_flex 的 v_storage_base/anon/colors pattern
--   - 用 v_employee_line_resolved view 取 LINE id（跟現有 trigger 一致）
--   - 用 net.http_post 推 LINE (pg_net 0.20.0 in public schema)
--   - app.skip_chain_notify GUC 沿用，避免雙推
-- ════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. _push_extra_signer_expense_flex — 加簽請求 LINE flex card（expense_request 版）
-- ═══════════════════════════════════════════════════════════════════════════
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

  -- 主視覺：用橘色標誌「加簽」跟一般簽核（粉紅）視覺區隔
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

  -- event 決定卡片標題 / 描述 / 顏色
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
      jsonb_build_object('type','text','text', '#' || v_req.id::text || ' · 加簽 #' || v_extra.id::text,
        'color', v_subtitle, 'size', 'xs', 'margin', 'xs')
    )
  );

  -- ── body rows ──
  -- 描述：發起人 → 加簽人（assigned 時）/ 加簽人 → 發起人（back 時）
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

  -- 案件 + 申請人 + 金額
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

  -- 加簽原因（assigned / approved_back 時都顯示，讓所有人看得到 context）
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

  -- 退回原因（reject 時顯示）
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

  -- ── footer ──
  -- LIFF URL（指到 expense_request 明細頁；加簽處理介面 P3 才接）
  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
                  || '?to=%2Fapprove%2Fexpense-request%3Fid%3D' || v_req.id::text;
  END IF;

  -- assigned 時：放「明細(LIFF)」鈕（核准/退回鈕之後 P3 接 postback）
  -- back 系列：只放「查看詳情」
  IF v_liff_url IS NOT NULL THEN
    v_footer_buttons := jsonb_build_array(
      jsonb_build_object(
        'type','button',
        'action', jsonb_build_object('type','uri','label', '📋 查看詳情','uri', v_liff_url),
        'style','primary','color',
          CASE p_event WHEN 'extra_assigned' THEN v_header_color
                       WHEN 'extra_approved_back' THEN v_color_success
                       WHEN 'extra_rejected_back' THEN v_color_danger
                       ELSE '#6b7280' END,
        'height','sm'
      )
    );
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

GRANT EXECUTE ON FUNCTION public._push_extra_signer_expense_flex(text, text, int, text)
  TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. _notify_extra_signer — 對某員工 (emp_id) 推加簽 LINE flex（fan-out helper）
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._notify_extra_signer(
  p_extra_id     int,
  p_target_emp_id int,
  p_event        text
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_extra approval_extra_steps;
  v_line  record;
  v_count int := 0;
BEGIN
  SELECT * INTO v_extra FROM approval_extra_steps WHERE id = p_extra_id;
  IF v_extra.id IS NULL THEN RETURN 0; END IF;

  -- 用 v_employee_line_resolved 取 LINE id + LIFF id
  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
      FROM v_employee_line_resolved v
     WHERE v.employee_id = p_target_emp_id
       AND v.line_user_id IS NOT NULL
     ORDER BY 1
  LOOP
    IF v_extra.source_table = 'expense_requests' THEN
      PERFORM public._push_extra_signer_expense_flex(
        v_line.line_user_id, v_line.liff_id, p_extra_id, p_event
      );
      v_count := v_count + 1;
    END IF;
    -- P3: 其他 source_table dispatch（leave / overtime / 採購 / tasks etc）
  END LOOP;

  RETURN v_count;
END
$$;

GRANT EXECUTE ON FUNCTION public._notify_extra_signer(int, int, text) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. AFTER INSERT trigger on approval_extra_steps → 推 LINE 給加簽人
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_extra_signer_inserted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  -- P2 only handles expense_requests
  IF NEW.source_table = 'expense_requests' THEN
    PERFORM public._notify_extra_signer(NEW.id, NEW.assignee_id, 'extra_assigned');
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_extra_signer_inserted ON public.approval_extra_steps;
CREATE TRIGGER trg_extra_signer_inserted
  AFTER INSERT ON public.approval_extra_steps
  FOR EACH ROW EXECUTE FUNCTION public._trg_extra_signer_inserted();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. AFTER UPDATE trigger on approval_extra_steps → 處理狀態變化的下游動作
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._trg_extra_signer_updated()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req expense_requests;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.source_table <> 'expense_requests' THEN RETURN NEW; END IF;

  -- pending → approved: 推 LINE 回原當前簽核者（發起人）「請繼續簽核」
  IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
    PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_approved_back');
    RETURN NEW;
  END IF;

  -- pending → rejected: 整單退回
  IF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
    -- 1. 把 expense_requests 設成已駁回
    --    現有 trg_notify_expense_request_updated 會自動推 LINE 給申請人
    SELECT * INTO v_req FROM expense_requests WHERE id = NEW.source_id;
    IF v_req.id IS NOT NULL AND v_req.status IN ('申請中', '待審') THEN
      UPDATE expense_requests
      SET status = '已駁回',
          reject_reason = '加簽人 ' || COALESCE(
            (SELECT name FROM employees WHERE id = NEW.assignee_id), '未知'
          ) || ' 退回：' || COALESCE(NEW.reject_reason, ''),
          approved_at = NOW()
      WHERE id = NEW.source_id;
    END IF;

    -- 2. 額外推一張卡給原當前簽核者（發起人）告知此單被加簽人退回
    PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_rejected_back');
    RETURN NEW;
  END IF;

  -- pending → cancelled: 通知加簽人
  IF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
    PERFORM public._notify_extra_signer(NEW.id, NEW.assignee_id, 'extra_cancelled_info');
    RETURN NEW;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_extra_signer_updated ON public.approval_extra_steps;
CREATE TRIGGER trg_extra_signer_updated
  AFTER UPDATE ON public.approval_extra_steps
  FOR EACH ROW EXECUTE FUNCTION public._trg_extra_signer_updated();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. expense_request_step_advance — 加 guard：有 pending extra 不准推進
--
-- 動既有 RPC 不可避免，但只在最前面加 1 個 IF 區塊；其他邏輯完全不動。
-- 對齊 20260508150000_fix_employee_matches_chain_step.sql 的版本。
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.expense_request_step_advance(
  p_id     INT,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_emp          employees;
  v_req          expense_requests;
  v_total_steps  INT;
  v_step         approval_chain_steps;
  v_matches      boolean;
  v_extra        approval_extra_steps;  -- ★ P2 加簽 guard
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF v_emp.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND'); END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = p_id;
  IF v_req.id IS NULL THEN RETURN json_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_req.status NOT IN ('申請中', '待審') THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING', 'current_status', v_req.status);
  END IF;

  -- ★ P2 加簽 guard：當前 step 若有 pending 加簽，禁止推進
  v_extra := public.get_pending_extra_step('expense_requests', p_id, COALESCE(v_req.current_step, 0));
  IF v_extra.id IS NOT NULL THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'PENDING_EXTRA_SIGNER',
      'extra_step_id', v_extra.id,
      'extra_assignee_id', v_extra.assignee_id,
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
    );
  END IF;

  -- 沒綁 chain → 退回到舊行為
  IF v_req.approval_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      UPDATE expense_requests SET
        status = '已核准', approved_by = v_emp.name, approved_at = NOW()
      WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'fully_approved', true);
    ELSE
      UPDATE expense_requests SET
        status = '已駁回', reject_reason = p_reason,
        approved_by = v_emp.name, approved_at = NOW()
      WHERE id = p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回');
    END IF;
  END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_req.approval_chain_id AND step_order = v_req.current_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND', 'current_step', v_req.current_step);
  END IF;

  SELECT _employee_matches_chain_step(v_emp.id, v_step.id, v_req.employee_id) INTO v_matches;
  IF NOT v_matches THEN
    RETURN json_build_object(
      'ok', false, 'error', 'NOT_AUTHORIZED_FOR_STEP',
      'current_step', v_req.current_step, 'expected_role', v_step.role_name
    );
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps
   WHERE chain_id = v_req.approval_chain_id;

  IF p_action = 'reject' THEN
    UPDATE expense_requests SET
      status = '已駁回', reject_reason = p_reason,
      approved_by = v_emp.name, approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'rejected_at_step', v_req.current_step);
  END IF;

  IF v_req.current_step + 1 >= v_total_steps THEN
    UPDATE expense_requests SET
      status = '已核准', current_step = v_total_steps,
      approved_by = v_emp.name, approved_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'fully_approved', true,
                             'advanced_to_step', v_total_steps);
  ELSE
    UPDATE expense_requests SET current_step = current_step + 1 WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '簽核中', 'fully_approved', false,
                             'advanced_to_step', v_req.current_step + 1);
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION public.expense_request_step_advance(INT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
