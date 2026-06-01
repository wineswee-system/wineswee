-- ════════════════════════════════════════════════════════════
-- 核銷鏈：補齊 時間軸記錄 + 加簽功能
-- ════════════════════════════════════════════════════════════
--
-- 補上主簽核鏈早就有但核銷鏈沒做的兩項功能：
--
-- A. 時間軸記錄
--    _trg_log_settle_step_history  — 監聽 settle_current_step 變化
--    trg_log_settle_step_history   — AFTER UPDATE on expense_requests
--
-- B. 加簽功能
--    _extra_step_allowed_tables()         — 加入 'expense_settles'
--    _push_extra_signer_expense_flex()    — 放寬 guard 接受 'expense_settles'
--    _notify_extra_signer()               — 加 'expense_settles' dispatch
--    _trg_extra_signer_inserted()         — 加 'expense_settles' 分支
--    _trg_extra_signer_updated()          — 加 'expense_settles' 分支
--    expense_settle_step_advance()        — 加 pending extra 守衛
-- ════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- A-1. 時間軸 trigger function
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trg_log_settle_step_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_snap_label  TEXT;
  v_snap_ttype  TEXT;
BEGIN
  -- status → 待核銷 AND settle_chain_id 剛設好 → 進入第 0 關
  IF NEW.status = '待核銷'
     AND (OLD.status IS DISTINCT FROM '待核銷' OR OLD.settle_chain_id IS DISTINCT FROM NEW.settle_chain_id)
     AND NEW.settle_chain_id IS NOT NULL THEN

    SELECT label, target_type INTO v_snap_label, v_snap_ttype
    FROM request_chain_snapshots
    WHERE request_type = 'expense_settle' AND request_id = NEW.id
      AND step_order = 0
    LIMIT 1;

    INSERT INTO approval_step_history (
      request_type, request_id, organization_id, chain_id,
      step_order, step_label, target_type, entered_at, action
    ) VALUES (
      'expense_settle', NEW.id, NEW.organization_id, NEW.settle_chain_id,
      0, v_snap_label, v_snap_ttype, NOW(), 'submitted'
    ) ON CONFLICT DO NOTHING;

    RETURN NEW;
  END IF;

  -- settle_current_step 推進 → 上一關 exit + 新關 entered
  IF NEW.settle_current_step IS DISTINCT FROM OLD.settle_current_step
     AND NEW.settle_chain_id IS NOT NULL
     AND NEW.status = '待核銷' THEN

    UPDATE approval_step_history
    SET exited_at = NOW(), action = 'approved'
    WHERE request_type = 'expense_settle' AND request_id = NEW.id
      AND step_order = OLD.settle_current_step AND exited_at IS NULL;

    SELECT label, target_type INTO v_snap_label, v_snap_ttype
    FROM request_chain_snapshots
    WHERE request_type = 'expense_settle' AND request_id = NEW.id
      AND step_order = NEW.settle_current_step
    LIMIT 1;

    IF v_snap_label IS NOT NULL THEN
      INSERT INTO approval_step_history (
        request_type, request_id, organization_id, chain_id,
        step_order, step_label, target_type, entered_at, action
      ) VALUES (
        'expense_settle', NEW.id, NEW.organization_id, NEW.settle_chain_id,
        NEW.settle_current_step, v_snap_label, v_snap_ttype, NOW(), 'pending'
      ) ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
  END IF;

  -- status → 已核銷 → 最後一關 exit approved
  IF NEW.status = '已核銷' AND OLD.status IS DISTINCT FROM '已核銷' THEN
    UPDATE approval_step_history
    SET exited_at = NOW(), action = 'approved',
        approver_name = COALESCE(NEW.settled_by, approver_name)
    WHERE request_type = 'expense_settle' AND request_id = NEW.id
      AND exited_at IS NULL;
    RETURN NEW;
  END IF;

  -- status → 核銷已退回 → 當前關 exit rejected
  IF NEW.status = '核銷已退回' AND OLD.status IS DISTINCT FROM '核銷已退回' THEN
    UPDATE approval_step_history
    SET exited_at = NOW(), action = 'rejected'
    WHERE request_type = 'expense_settle' AND request_id = NEW.id
      AND exited_at IS NULL;
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_settle_step_history ON public.expense_requests;
CREATE TRIGGER trg_log_settle_step_history
  AFTER UPDATE ON public.expense_requests
  FOR EACH ROW EXECUTE FUNCTION public._trg_log_settle_step_history();


-- ══════════════════════════════════════════════════════════════
-- B-1. 加簽白名單加入 'expense_settles'
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._extra_step_allowed_tables()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'leave_requests',
    'overtime_requests',
    'business_trips',
    'clock_corrections',
    'expenses',
    'resignation_requests',
    'personnel_transfer_requests',
    'leave_of_absence_requests',
    'expense_requests',
    'tasks',
    'expense_settles'   -- 核銷鏈加簽
  ]::text[]
$$;


-- ══════════════════════════════════════════════════════════════
-- B-2. 放寬 _push_extra_signer_expense_flex guard
--      expense_settles 的 source_id 也是 expense_requests.id，
--      資料完全相容，直接共用同一張卡
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._push_extra_signer_expense_flex(
  p_line_user_id text,
  p_liff_id      text,
  p_extra_id     int,
  p_event        text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_push_url    CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon        CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';
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
BEGIN
  IF p_line_user_id IS NULL OR p_line_user_id = '' THEN RETURN; END IF;

  SELECT * INTO v_extra FROM approval_extra_steps WHERE id = p_extra_id;
  -- 支援 expense_requests + expense_settles（source_id 都是 expense_requests.id）
  IF v_extra.id IS NULL OR
     v_extra.source_table NOT IN ('expense_requests', 'expense_settles') THEN RETURN; END IF;

  SELECT * INTO v_req FROM expense_requests WHERE id = v_extra.source_id;
  IF v_req.id IS NULL THEN RETURN; END IF;

  SELECT name INTO v_requester_name FROM employees WHERE id = v_extra.requested_by_id;
  SELECT name INTO v_assignee_name  FROM employees WHERE id = v_extra.assignee_id;

  v_amount_str := 'NT$ ' || to_char(
    COALESCE(v_req.actual_amount, v_req.estimated_amount, 0), 'FM999,999,999,999'
  );

  IF p_event = 'extra_assigned' THEN
    v_emoji := '🪶'; v_label := CASE v_extra.source_table
      WHEN 'expense_settles' THEN '核銷加簽請求' ELSE '加簽請求' END;
    v_status_chip := '待你處理';
    v_alt_text := '🪶 ' || v_label || ' — ' || COALESCE(v_req.title, '');
  ELSIF p_event = 'extra_approved_back' THEN
    v_emoji := '✅'; v_label := '加簽已通過';
    v_status_chip := '請繼續簽核';
    v_alt_text := '✅ 加簽已通過，請繼續簽核';
  ELSIF p_event = 'extra_rejected_back' THEN
    v_emoji := '❌'; v_label := '加簽人退回';
    v_status_chip := '已退回';
    v_alt_text := '❌ 加簽人退回此單';
  ELSE -- extra_cancelled_info
    v_emoji := '🚫'; v_label := '加簽已撤銷';
    v_status_chip := '已撤銷';
    v_alt_text := '🚫 加簽請求已撤銷';
  END IF;

  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
      || '?to=%2Fapprove%3Ftype%3D' || v_extra.source_table
      || '%26id%3D' || v_extra.source_id::text;
  END IF;

  v_header := jsonb_build_object(
    'type','box','layout','vertical','paddingAll','16px','backgroundColor', v_header_color,
    'contents', jsonb_build_array(
      jsonb_build_object('type','box','layout','horizontal','contents', jsonb_build_array(
        jsonb_build_object('type','text','text', v_emoji || ' ' || v_label,
          'color', v_text_white,'weight','bold','size','lg','flex',5),
        jsonb_build_object('type','text','text', v_status_chip,
          'color', v_text_white_muted,'size','xs','align','end','gravity','center','flex',3)
      )),
      jsonb_build_object('type','text','text','#' || v_extra.source_id::text,
        'color', v_subtitle,'size','xs','margin','xs')
    )
  );

  v_rows := jsonb_build_array(
    jsonb_build_object('type','box','layout','horizontal','spacing','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','📋','size','lg','flex',0),
        jsonb_build_object('type','box','layout','vertical','flex',7,'contents', jsonb_build_array(
          jsonb_build_object('type','text','text', COALESCE(v_req.title, '—'),
            'weight','bold','size','md','color', v_text_title),
          jsonb_build_object('type','text','text', COALESCE(v_req.employee,''),
            'size','xs','color', v_text_secondary,'margin','none')
        ))
      )
    ),
    jsonb_build_object('type','separator','margin','md'),
    jsonb_build_object('type','box','layout','horizontal','margin','sm','contents', jsonb_build_array(
      jsonb_build_object('type','text','text','金額','size','sm','color', v_text_label,'flex',2),
      jsonb_build_object('type','text','text', v_amount_str,'size','sm','weight','bold',
        'color', v_text_body,'flex',5,'wrap',true)
    )),
    jsonb_build_object('type','box','layout','horizontal','margin','sm','contents', jsonb_build_array(
      jsonb_build_object('type','text','text',
        CASE p_event WHEN 'extra_assigned' THEN '發起人' ELSE '加簽人' END,
        'size','sm','color', v_text_label,'flex',2),
      jsonb_build_object('type','text','text',
        CASE p_event WHEN 'extra_assigned' THEN COALESCE(v_requester_name,'—')
             ELSE COALESCE(v_assignee_name,'—') END,
        'size','sm','color', v_text_body,'flex',5,'wrap',true)
    ))
  );

  IF v_extra.reason IS NOT NULL AND btrim(v_extra.reason) <> '' THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object('type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FFF7ED','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 加簽原因','size','xxs','color','#C2410C','weight','bold'),
          jsonb_build_object('type','text','text', v_extra.reason,'size','sm','color', v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  v_body := jsonb_build_object('type','box','layout','vertical','spacing','sm',
    'paddingAll','16px','contents', v_rows);

  IF v_liff_url IS NOT NULL THEN
    v_footer_buttons := jsonb_build_array(
      jsonb_build_object('type','button',
        'action', jsonb_build_object('type','uri','label','📋 查看詳情','uri', v_liff_url),
        'style','secondary','height','sm')
    );
  END IF;

  v_footer := jsonb_build_object('type','box','layout','vertical','spacing','sm',
    'paddingAll','12px','contents', v_footer_buttons);

  v_payload := jsonb_build_object(
    'to', p_line_user_id,
    'messages', jsonb_build_array(
      jsonb_build_object('type','flex','altText', v_alt_text,
        'contents', jsonb_build_object(
          'type','bubble','size','kilo',
          'header', v_header,'body', v_body,'footer', v_footer
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

GRANT EXECUTE ON FUNCTION public._push_extra_signer_expense_flex(text,text,int,text)
  TO authenticated, service_role;


-- ══════════════════════════════════════════════════════════════
-- B-3. _notify_extra_signer — 加 expense_settles dispatch
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._notify_extra_signer(
  p_extra_id      int,
  p_target_emp_id int,
  p_event         text
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

  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
    FROM v_employee_line_resolved v
    WHERE v.employee_id = p_target_emp_id AND v.line_user_id IS NOT NULL
    ORDER BY 1
  LOOP
    IF v_extra.source_table IN ('expense_requests', 'expense_settles') THEN
      PERFORM public._push_extra_signer_expense_flex(
        v_line.line_user_id, v_line.liff_id, p_extra_id, p_event
      );
      v_count := v_count + 1;
    END IF;
    -- P3: 其他 source_table dispatch（leave / overtime / 採購 / tasks etc）
  END LOOP;

  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public._notify_extra_signer(int,int,text)
  TO authenticated, service_role;


-- ══════════════════════════════════════════════════════════════
-- B-4. _trg_extra_signer_inserted — 加 expense_settles 分支
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trg_extra_signer_inserted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  IF NEW.source_table IN ('expense_requests', 'expense_settles') THEN
    PERFORM public._notify_extra_signer(NEW.id, NEW.assignee_id, 'extra_assigned');
  END IF;

  RETURN NEW;
END $$;


-- ══════════════════════════════════════════════════════════════
-- B-5. _trg_extra_signer_updated — 加 expense_settles 分支
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._trg_extra_signer_updated()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req expense_requests;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- ── expense_requests（原有邏輯不動）────────────────────────
  IF NEW.source_table = 'expense_requests' THEN
    IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
      PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_approved_back');
    ELSIF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
      SELECT * INTO v_req FROM expense_requests WHERE id = NEW.source_id;
      IF v_req.id IS NOT NULL AND v_req.status IN ('申請中','待審') THEN
        UPDATE expense_requests
        SET status = '已駁回',
            reject_reason = '加簽人 ' || COALESCE(
              (SELECT name FROM employees WHERE id = NEW.assignee_id), '未知'
            ) || ' 退回：' || COALESCE(NEW.reject_reason, ''),
            approved_at = NOW()
        WHERE id = NEW.source_id;
      END IF;
      PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_rejected_back');
    ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
      PERFORM public._notify_extra_signer(NEW.id, NEW.assignee_id, 'extra_cancelled_info');
    END IF;
    RETURN NEW;
  END IF;

  -- ── expense_settles（核銷鏈加簽）─────────────────────────
  IF NEW.source_table = 'expense_settles' THEN
    IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
      -- 加簽通過 → 通知原本的核銷鏈簽核者繼續
      PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_approved_back');
    ELSIF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
      -- 加簽退回 → 核銷單整單退回
      SELECT * INTO v_req FROM expense_requests WHERE id = NEW.source_id;
      IF v_req.id IS NOT NULL AND v_req.status = '待核銷' THEN
        UPDATE expense_requests
        SET status = '核銷已退回',
            settle_reject_reason = '加簽人 ' || COALESCE(
              (SELECT name FROM employees WHERE id = NEW.assignee_id), '未知'
            ) || ' 退回：' || COALESCE(NEW.reject_reason, '')
        WHERE id = NEW.source_id;
      END IF;
      PERFORM public._notify_extra_signer(NEW.id, NEW.requested_by_id, 'extra_rejected_back');
    ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
      PERFORM public._notify_extra_signer(NEW.id, NEW.assignee_id, 'extra_cancelled_info');
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;


-- ══════════════════════════════════════════════════════════════
-- B-6. expense_settle_step_advance — 加 pending extra step 守衛
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.expense_settle_step_advance(
  p_id     INT,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_emp           employees;
  v_req           expense_requests;
  v_total_steps   INT;
  v_step          approval_chain_steps;
  v_matches       boolean;
  v_amount        NUMERIC;
  v_pending_extra INT;
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

  -- 有 pending 加簽時不允許推進
  SELECT id INTO v_pending_extra
  FROM approval_extra_steps
  WHERE source_table = 'expense_settles'
    AND source_id = p_id
    AND insert_before_step = v_req.settle_current_step
    AND status = 'pending'
  LIMIT 1;
  IF v_pending_extra IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'PENDING_EXTRA_STEP', 'extra_step_id', v_pending_extra);
  END IF;

  -- 沒掛 settle chain → fallback：admin 一鍵 confirm
  IF v_req.settle_chain_id IS NULL THEN
    BEGIN
      PERFORM secure_create_journal_entry(
        CURRENT_DATE,
        '費用申請核銷 - ' || v_req.employee || ' (' || v_req.title || ')',
        json_build_array(
          json_build_object('account_code', v_req.account_code, 'account_name', v_req.account_name, 'debit', v_amount, 'credit', 0, 'memo', '申請單 #' || v_req.id),
          json_build_object('account_code', '1100', 'account_name', '現金', 'debit', 0, 'credit', v_amount, 'memo', '')
        )::jsonb,
        '費用申請', v_req.id, v_emp.name
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    UPDATE expense_requests SET status = '已核銷', settled_by = v_emp.name, settled_at = NOW()
    WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核銷', 'fully_settled', true, 'fallback', true);
  END IF;

  SELECT * INTO v_step FROM approval_chain_steps
   WHERE chain_id = v_req.settle_chain_id AND step_order = v_req.settle_current_step;
  IF v_step.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'STEP_NOT_FOUND', 'current_step', v_req.settle_current_step);
  END IF;

  SELECT _employee_matches_chain_step(v_emp.id, v_step.id) INTO v_matches;
  IF NOT v_matches THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHORIZED_FOR_STEP',
                             'current_step', v_req.settle_current_step);
  END IF;

  SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps
   WHERE chain_id = v_req.settle_chain_id;

  IF p_action = 'reject' THEN
    UPDATE expense_requests SET status = '核銷已退回', settle_reject_reason = p_reason WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '核銷已退回', 'rejected_at_step', v_req.settle_current_step);
  END IF;

  IF v_req.settle_current_step + 1 >= v_total_steps THEN
    BEGIN
      PERFORM secure_create_journal_entry(
        CURRENT_DATE,
        '費用申請核銷 - ' || v_req.employee || ' (' || v_req.title || ')',
        json_build_array(
          json_build_object('account_code', v_req.account_code, 'account_name', v_req.account_name, 'debit', v_amount, 'credit', 0, 'memo', '申請單 #' || v_req.id),
          json_build_object('account_code', '1100', 'account_name', '現金', 'debit', 0, 'credit', v_amount, 'memo', '')
        )::jsonb,
        '費用申請', v_req.id, v_emp.name
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    UPDATE expense_requests SET status = '已核銷', settle_current_step = v_total_steps,
      settled_by = v_emp.name, settled_at = NOW() WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '已核銷', 'fully_settled', true,
                             'advanced_to_step', v_total_steps);
  ELSE
    UPDATE expense_requests SET settle_current_step = settle_current_step + 1 WHERE id = p_id;
    RETURN json_build_object('ok', true, 'status', '核銷中', 'fully_settled', false,
                             'advanced_to_step', v_req.settle_current_step + 1);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.expense_settle_step_advance(INT, TEXT, TEXT) TO authenticated;


COMMIT;

NOTIFY pgrst, 'reload schema';
