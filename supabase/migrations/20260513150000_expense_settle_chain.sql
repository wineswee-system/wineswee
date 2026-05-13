-- ════════════════════════════════════════════════════════════
-- 費用核銷簽核鏈 — 員工填核銷後走 chain，最後一關通過才開分錄
-- 2026-05-13
--
-- 流程：
--   申請中 → (chain category=費用申請) → 已核准
--   → 員工填 actual_amount + 收據 → status=待核銷 + auto-apply settle chain
--   → (chain category=費用核銷) → 最後一關通過 → status=已核銷 + 開分錄
--   → 任何一關駁回 → status=核銷已退回 + settle_reject_reason
--
-- 鏡像 expense_request 申請鏈（20260507250000 / 20260508110000）
-- 設定金額分流：ChainConfigModal(formLabel='費用核銷', mode='amount_grouped')
-- 沒設核銷 chain → fallback 走舊行為（admin 一鍵 confirm）
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ═══ 1. 加欄位 ═══
ALTER TABLE public.expense_requests
  ADD COLUMN IF NOT EXISTS settle_chain_id INT REFERENCES approval_chains(id),
  ADD COLUMN IF NOT EXISTS settle_current_step INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settle_reject_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_expense_req_settle_chain ON expense_requests(settle_chain_id);


-- ═══ 2. 員工送出核銷時自動掛 chain（依 actual_amount + category=費用核銷） ═══
CREATE OR REPLACE FUNCTION public.auto_apply_expense_settle_chain()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_chain_id INT;
  v_amount NUMERIC;
BEGIN
  -- 只在 status 進入 '待核銷' 且還沒掛 chain 時動作
  IF NEW.status IS DISTINCT FROM '待核銷' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = '待核銷' THEN RETURN NEW; END IF;
  IF NEW.settle_chain_id IS NOT NULL THEN RETURN NEW; END IF;

  v_amount := COALESCE(NEW.actual_amount, NEW.estimated_amount, 0);

  SELECT id INTO v_chain_id
  FROM public.approval_chains
  WHERE category = '費用核銷'
    AND COALESCE(is_active, true) = true
    AND (min_amount IS NULL OR min_amount <= v_amount)
    AND (max_amount IS NULL OR max_amount >= v_amount)
  ORDER BY COALESCE(min_amount, 0) DESC
  LIMIT 1;

  IF v_chain_id IS NOT NULL THEN
    NEW.settle_chain_id := v_chain_id;
    NEW.settle_current_step := 0;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_apply_expense_settle_chain ON public.expense_requests;
CREATE TRIGGER trg_auto_apply_expense_settle_chain
  BEFORE UPDATE OF status ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public.auto_apply_expense_settle_chain();


-- ═══ 3. step advance RPC ═══
CREATE OR REPLACE FUNCTION public.expense_settle_step_advance(
  p_id     INT,
  p_action TEXT,         -- 'approve' | 'reject'
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
  v_amount       NUMERIC;
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
  IF v_req.status <> '待核銷' THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_PENDING_SETTLE', 'current_status', v_req.status);
  END IF;

  v_amount := COALESCE(v_req.actual_amount, v_req.estimated_amount, 0);

  -- 沒掛 settle chain → fallback：admin 一鍵 confirm（開分錄 + 已核銷）
  IF v_req.settle_chain_id IS NULL THEN
    BEGIN
      PERFORM secure_create_journal_entry(
        CURRENT_DATE,
        '費用申請核銷 - ' || v_req.employee || ' (' || v_req.title || ')',
        json_build_array(
          json_build_object('account_code', v_req.account_code, 'account_name', v_req.account_name, 'debit', v_amount, 'credit', 0, 'memo', '申請單 #' || v_req.id),
          json_build_object('account_code', '1100', 'account_name', '現金', 'debit', 0, 'credit', v_amount, 'memo', '')
        )::jsonb,
        '費用申請',
        v_req.id,
        v_emp.name
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    UPDATE expense_requests SET
      status = '已核銷',
      settled_by = v_emp.name,
      settled_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核銷', 'fully_settled', true, 'fallback', true);
  END IF;

  -- 抓目前這一關
  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_req.settle_chain_id AND step_order = v_req.settle_current_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND', 'current_step', v_req.settle_current_step);
  END IF;

  -- 驗證 caller 是否對應這一關
  SELECT _employee_matches_chain_step(v_emp.id, v_step.id) INTO v_matches;
  IF NOT v_matches THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED_FOR_STEP',
                             'current_step', v_req.settle_current_step);
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps
   WHERE chain_id = v_req.settle_chain_id;

  IF p_action = 'reject' THEN
    UPDATE expense_requests SET
      status = '核銷已退回',
      settle_reject_reason = p_reason
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '核銷已退回', 'rejected_at_step', v_req.settle_current_step);
  END IF;

  -- approve
  IF v_req.settle_current_step + 1 >= v_total_steps THEN
    -- 最後一關 → 全鏈通過 → 開分錄 + 已核銷
    BEGIN
      PERFORM secure_create_journal_entry(
        CURRENT_DATE,
        '費用申請核銷 - ' || v_req.employee || ' (' || v_req.title || ')',
        json_build_array(
          json_build_object('account_code', v_req.account_code, 'account_name', v_req.account_name, 'debit', v_amount, 'credit', 0, 'memo', '申請單 #' || v_req.id),
          json_build_object('account_code', '1100', 'account_name', '現金', 'debit', 0, 'credit', v_amount, 'memo', '')
        )::jsonb,
        '費用申請',
        v_req.id,
        v_emp.name
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    UPDATE expense_requests SET
      status = '已核銷',
      settle_current_step = v_total_steps,
      settled_by = v_emp.name,
      settled_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核銷', 'fully_settled', true,
                             'advanced_to_step', v_total_steps);
  ELSE
    UPDATE expense_requests SET
      settle_current_step = settle_current_step + 1
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '核銷中', 'fully_settled', false,
                             'advanced_to_step', v_req.settle_current_step + 1);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.expense_settle_step_advance(INT, TEXT, TEXT) TO authenticated;


-- ═══ 4. LINE flex 卡片（核銷專用） ═══
CREATE OR REPLACE FUNCTION public._push_expense_settle_flex(
  p_line_user_id text,
  p_liff_id      text,
  p_request_id   int,
  p_event        text         -- 'settle_assigned' | 'settle_approved' | 'settle_rejected'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
  v_label        CONSTANT text := '費用核銷';

  v_req          expense_requests;
  v_dept         text;

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

  v_amount_str := 'NT$ ' || to_char(COALESCE(v_req.actual_amount, 0), 'FM999,999,999,999');
  v_est_str    := 'NT$ ' || to_char(COALESCE(v_req.estimated_amount, 0), 'FM999,999,999,999');
  IF v_req.actual_amount IS NOT NULL AND v_req.estimated_amount IS NOT NULL THEN
    v_diff_str := CASE
      WHEN v_req.actual_amount > v_req.estimated_amount THEN '+'
      ELSE ''
    END || to_char(v_req.actual_amount - v_req.estimated_amount, 'FM999,999,999,999');
  END IF;

  IF p_event = 'settle_approved' THEN
    v_status_chip := '已核銷';
    v_alt_text := v_emoji || ' 核銷已通過 — ' || COALESCE(v_req.title, '');
  ELSIF p_event = 'settle_rejected' THEN
    v_status_chip := '核銷已退回';
    v_alt_text := v_emoji || ' 核銷被退回 — ' || COALESCE(v_req.title, '');
  ELSE
    v_status_chip := '待你審核';
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
END $$;

GRANT EXECUTE ON FUNCTION public._push_expense_settle_flex(text, text, int, text)
  TO authenticated, service_role;


-- ═══ 5. 對 settle 第 N 關推 LINE ═══
CREATE OR REPLACE FUNCTION public._notify_expense_settle_step(
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
  IF v_req.id IS NULL OR v_req.settle_chain_id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO v_step
    FROM approval_chain_steps
   WHERE chain_id = v_req.settle_chain_id AND step_order = p_step_order;
  IF v_step.id IS NULL THEN RETURN 0; END IF;

  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
      FROM resolve_chain_step_approvers(v_step.id, v_req.employee_id) a
      JOIN v_employee_line_resolved v ON v.employee_id = a.emp_id
                                     AND v.line_user_id = a.line_user_id
     WHERE v.line_user_id IS NOT NULL
  LOOP
    PERFORM public._push_expense_settle_flex(
      v_line.line_user_id, v_line.liff_id, v_req.id, 'settle_assigned'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public._notify_expense_settle_step(int, int) TO authenticated, service_role;


-- ═══ 6. AFTER UPDATE trigger → settle chain 變動推 LINE ═══
CREATE OR REPLACE FUNCTION public._trg_notify_expense_settle_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_app_line text;
  v_app_liff text;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;

  -- 員工剛送出核銷 (status → 待核銷) 且有掛 chain → 推第一關
  IF NEW.status = '待核銷' AND OLD.status IS DISTINCT FROM '待核銷'
     AND NEW.settle_chain_id IS NOT NULL THEN
    PERFORM public._notify_expense_settle_step(NEW.id, COALESCE(NEW.settle_current_step, 0));
    RETURN NEW;
  END IF;

  -- settle chain 推進到下一關 → 推下一關 approver
  IF NEW.status = '待核銷'
     AND NEW.settle_current_step > COALESCE(OLD.settle_current_step, 0)
     AND NEW.settle_chain_id IS NOT NULL THEN
    PERFORM public._notify_expense_settle_step(NEW.id, NEW.settle_current_step);
    RETURN NEW;
  END IF;

  -- 已核銷 → 推申請人
  IF NEW.status = '已核銷' AND OLD.status IS DISTINCT FROM '已核銷' THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v
     WHERE v.employee_id = NEW.employee_id
     ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
     LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_expense_settle_flex(v_app_line, v_app_liff, NEW.id, 'settle_approved');
    END IF;
    RETURN NEW;
  END IF;

  -- 核銷已退回 → 推申請人 + reason
  IF NEW.status = '核銷已退回' AND OLD.status IS DISTINCT FROM '核銷已退回' THEN
    SELECT v.line_user_id, v.liff_id INTO v_app_line, v_app_liff
      FROM v_employee_line_resolved v
     WHERE v.employee_id = NEW.employee_id
     ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
     LIMIT 1;
    IF v_app_line IS NOT NULL THEN
      PERFORM public._push_expense_settle_flex(v_app_line, v_app_liff, NEW.id, 'settle_rejected');
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_expense_settle_updated ON public.expense_requests;
CREATE TRIGGER trg_notify_expense_settle_updated
  AFTER UPDATE ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_notify_expense_settle_updated();


COMMIT;

NOTIFY pgrst, 'reload schema';

-- 驗證：
-- SELECT column_name FROM information_schema.columns WHERE table_name='expense_requests' AND column_name LIKE 'settle%';
-- SELECT proname FROM pg_proc WHERE proname IN ('expense_settle_step_advance','_push_expense_settle_flex','_notify_expense_settle_step');
-- SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_auto_apply_expense_settle_chain','trg_notify_expense_settle_updated');
