-- HR 簽核:編輯重送→從關0重簽 + 駁回時通知前面已簽過的關 — 2026-07-27
-- ════════════════════════════════════════════════════════════════════════════
-- 需求:
--   (A) HR 單被駁回後「編輯重送」→ 整條簽核鏈從關0 重新簽(原本 HR A 停在被駁那關續簽)。
--   (B) 某關駁回時,前面已經簽過的關(關0..被駁關-1)也收到 LINE:「你簽核過的這張被退回了」。
-- 涵蓋兩套 HR:
--   HR A(請假 leave / 加班 overtime / 出差 trip):status 待簽='待審核',被駁='已退回'/'已駁回'。
--   HR B(離職 resignation / 留停 loa / 調動 transfer / 增補 headcount):待簽='申請中',被駁='已駁回'。
-- 設計原則:全部用「新 trigger + 新函式」,現有 trigger/函式完全不動,只在卡片組裝器加一個事件。
--   * 重送歸0:BEFORE UPDATE 偵測「被駁→回待簽」設 current_step=0(step0 快照實測無 auto_skip,安全)。
--     HR B 前端本就已歸0,此 trigger 對它是等效覆寫(順帶把任何漏歸0的路徑補上)。
--   * 重送後重新通知關0:AFTER UPDATE,重用現成 _notify_hr_request_approvers(HR A)/_notify_hr_b_step(HR B)。
--   * 駁回通知已簽人:AFTER UPDATE,新函式 _notify_hr_prior_signers_rejected,靠凍結快照
--     resolve_snapshot_step_approvers 解出「當初實際會簽的人」,推簽核人專用卡(新事件)。
--   * 兩個 AFTER 行為都吃 app.skip_chain_notify guard(批次/強簽時 0 通知)。
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. 卡片組裝器:新增「通知已簽核人:被退回」事件 rejected_notify_signer ──────────
--     (逐字重貼 _push_hr_chain_flex,只在事件段插一個 ELSIF;footer 的 ELSE 分支
--      本就是「只有查看詳情鈕」,剛好給簽核人卡用,不需其他改動。)
CREATE OR REPLACE FUNCTION public._push_hr_chain_flex(p_line_user_id text, p_liff_id text, p_rt text, p_id integer, p_applicant text, p_dept text, p_event text, p_extra_rows jsonb, p_reason_block jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_push_url   CONSTANT text := 'https://mvkvnuxeamahhfahclmi.supabase.co/functions/v1/line-push';
  v_anon       CONSTANT text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12a3ZudXhlYW1haGhmYWhjbG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODM3NDIsImV4cCI6MjA5MDE1OTc0Mn0.XdwpFEvels80p8A7u99hV-SChf_vu2jbb-28q8qJLoo';

  v_text_white       CONSTANT text := '#FFFFFF';
  v_text_white_muted CONSTANT text := '#FFFFFFAA';
  v_text_title       CONSTANT text := '#111827';
  v_text_secondary   CONSTANT text := '#666666';

  v_header_color    text;
  v_subtitle        text;
  v_emoji           text;
  v_label           text;
  v_status_chip     text;
  v_alt_text        text;
  v_liff_url        text;
  v_liff_extra_url  text;
  v_payload         jsonb;
  v_rows            jsonb;
  v_applicant_inner jsonb;
  v_footer_buttons  jsonb := '[]'::jsonb;
  v_header          jsonb;
  v_body            jsonb;
  v_footer          jsonb;
BEGIN
  IF p_line_user_id IS NULL OR p_line_user_id = '' THEN RETURN; END IF;

  -- palette by rt
  CASE p_rt
    WHEN 'resignation' THEN
      v_header_color := '#6b7280'; v_subtitle := '#E5E7EB'; v_emoji := '📤'; v_label := '離職申請';
    WHEN 'transfer' THEN
      v_header_color := '#8b5cf6'; v_subtitle := '#E9D5FF'; v_emoji := '🔄'; v_label := '異動申請';
    WHEN 'loa' THEN
      v_header_color := '#f59e0b'; v_subtitle := '#FDE68A'; v_emoji := '⏸';   v_label := '留職停薪';
    WHEN 'leave' THEN
      v_header_color := '#10b981'; v_subtitle := '#A7F3D0'; v_emoji := '🏖'; v_label := '請假申請';
    WHEN 'overtime' THEN
      v_header_color := '#f59e0b'; v_subtitle := '#FDE68A'; v_emoji := '⏰'; v_label := '加班申請';
    WHEN 'trip' THEN
      v_header_color := '#3b82f6'; v_subtitle := '#BFDBFE'; v_emoji := '✈️'; v_label := '出差申請';
    WHEN 'correction' THEN
      v_header_color := '#8b5cf6'; v_subtitle := '#E9D5FF'; v_emoji := '🔧'; v_label := '補打卡申請';
    WHEN 'expense' THEN
      v_header_color := '#ec4899'; v_subtitle := '#FBCFE8'; v_emoji := '💰'; v_label := '報帳申請';
    ELSE
      v_header_color := '#4A4A4A'; v_subtitle := '#CCCCCC'; v_emoji := '📋'; v_label := COALESCE(p_rt, '簽核');
  END CASE;

  IF p_event = 'request_approved' THEN
    v_status_chip := '已核准';
    v_alt_text := v_emoji || ' ' || v_label || '已通過 — ' || COALESCE(p_applicant, '');
  ELSIF p_event = 'request_rejected' THEN
    v_status_chip := '已退回';
    v_alt_text := v_emoji || ' ' || v_label || '被退回 — ' || COALESCE(p_applicant, '');
  ELSIF p_event = 'rejected_notify_signer' THEN
    v_status_chip := '你簽過·已退回';
    v_alt_text := v_emoji || ' ' || v_label || '(你簽核過)已被退回 — ' || COALESCE(p_applicant, '');
  ELSE
    v_status_chip := '待你審核';
    v_alt_text := v_emoji || ' ' || v_label || ' — ' || COALESCE(p_applicant, '');
  END IF;

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
      jsonb_build_object('type','text','text', '#' || p_id,
        'color', v_subtitle, 'size', 'xs', 'margin', 'xs')
    )
  );

  v_applicant_inner := jsonb_build_array(
    jsonb_build_object('type','text','text', COALESCE(p_applicant, ''),
      'weight','bold','size','md','color', v_text_title)
  );
  IF p_dept IS NOT NULL AND p_dept <> '' THEN
    v_applicant_inner := v_applicant_inner || jsonb_build_array(
      jsonb_build_object('type','text','text', p_dept,
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

  v_rows := v_rows || COALESCE(p_extra_rows, '[]'::jsonb) || COALESCE(p_reason_block, '[]'::jsonb);

  v_body := jsonb_build_object(
    'type', 'box', 'layout', 'vertical', 'spacing', 'sm', 'paddingAll', '16px',
    'contents', v_rows
  );

  -- ── footer ──
  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
                  || '?to=%2Fapprove%3Ftype%3D' || p_rt || '%26id%3D' || p_id::text;
    -- 加簽深連結：帶 extra=1 讓 LIFF 直接捲到加簽區
    v_liff_extra_url := v_liff_url || '%26extra%3D1';

    IF p_event = 'step_assigned' THEN
      -- Row 1: 核准（postback） + 駁回（postback）
      -- Row 2: 加簽（LIFF）+ 詳情（LIFF）
      v_footer_buttons := jsonb_build_array(
        jsonb_build_object(
          'type','box','layout','horizontal','spacing','sm',
          'contents', jsonb_build_array(
            jsonb_build_object(
              'type','button','style','primary','color','#16a34a','height','sm','flex',1,
              'action', jsonb_build_object(
                'type','postback',
                'label','✅ 核准',
                'data', 'action=approve&type=request&rt=' || p_rt || '&id=' || p_id::text,
                'displayText','✅ 核准'
              )
            ),
            jsonb_build_object(
              'type','button','style','primary','color','#dc2626','height','sm','flex',1,
              'action', jsonb_build_object(
                'type','postback',
                'label','❌ 駁回',
                'data', 'action=reject&type=request&rt=' || p_rt || '&id=' || p_id::text,
                'displayText','❌ 駁回'
              )
            )
          )
        ),
        jsonb_build_object(
          'type','box','layout','horizontal','spacing','sm','margin','sm',
          'contents', jsonb_build_array(
            jsonb_build_object(
              'type','button','style','secondary','height','sm','flex',1,
              'action', jsonb_build_object(
                'type','uri',
                'label','✍️ 加簽',
                'uri', v_liff_extra_url
              )
            ),
            jsonb_build_object(
              'type','button','style','secondary','height','sm','flex',1,
              'action', jsonb_build_object(
                'type','uri',
                'label','📋 詳情',
                'uri', v_liff_url
              )
            )
          )
        )
      );
    ELSE
      -- request_approved / request_rejected / rejected_notify_signer: 只有查看詳情
      v_footer_buttons := jsonb_build_array(
        jsonb_build_object(
          'type','button',
          'action', jsonb_build_object('type','uri','label','📋 查看詳情','uri', v_liff_url),
          'style','primary','color', v_header_color,'height','sm'
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
END $function$;

-- ── 2. 新函式:駁回時通知關0..被駁關-1 的已簽核人(簽核人專用卡)──────────────────
CREATE OR REPLACE FUNCTION public._notify_hr_prior_signers_rejected(
  p_snap_rt text, p_id integer, p_applicant_id integer, p_rejected_step integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_card_rt text;
  v_count   int := 0;
  v_line    record;
BEGIN
  IF p_rejected_step IS NULL OR p_rejected_step < 1 THEN RETURN 0; END IF;
  -- 只在有凍結快照時通知(確保是「當初實際會簽的人」;無快照的舊單直接跳過)
  IF NOT EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = p_snap_rt AND request_id = p_id
  ) THEN
    RETURN 0;
  END IF;

  v_card_rt := CASE p_snap_rt
    WHEN 'leave_request'    THEN 'leave'
    WHEN 'overtime_request' THEN 'overtime'
    ELSE p_snap_rt   -- trip / resignation / loa / transfer / headcount 卡片 rt 同名
  END;

  -- 收集關0..被駁關-1 的所有簽核人 line target(去重、排除申請人自己)
  FOR v_line IN
    SELECT DISTINCT v.line_user_id, v.liff_id
      FROM generate_series(0, p_rejected_step - 1) AS gs(step)
      CROSS JOIN LATERAL public.resolve_snapshot_step_approvers(
                   p_snap_rt, p_id, gs.step, p_applicant_id) a
      JOIN public.v_employee_line_resolved v
        ON v.employee_id = a.emp_id AND v.line_user_id = a.line_user_id
     WHERE v.line_user_id IS NOT NULL
       AND a.emp_id IS DISTINCT FROM p_applicant_id
  LOOP
    IF    v_card_rt = 'leave'       THEN PERFORM public._push_leave_flex(v_line.line_user_id, v_line.liff_id, p_id, 'rejected_notify_signer');
    ELSIF v_card_rt = 'overtime'    THEN PERFORM public._push_overtime_flex(v_line.line_user_id, v_line.liff_id, p_id, 'rejected_notify_signer');
    ELSIF v_card_rt = 'trip'        THEN PERFORM public._push_trip_flex(v_line.line_user_id, v_line.liff_id, p_id, 'rejected_notify_signer');
    ELSIF v_card_rt = 'resignation' THEN PERFORM public._push_resignation_flex(v_line.line_user_id, v_line.liff_id, p_id, 'rejected_notify_signer');
    ELSIF v_card_rt = 'loa'         THEN PERFORM public._push_loa_flex(v_line.line_user_id, v_line.liff_id, p_id, 'rejected_notify_signer');
    ELSIF v_card_rt = 'transfer'    THEN PERFORM public._push_transfer_flex(v_line.line_user_id, v_line.liff_id, p_id, 'rejected_notify_signer');
    ELSIF v_card_rt = 'headcount'   THEN PERFORM public._push_headcount_flex(v_line.line_user_id, v_line.liff_id, p_id, 'rejected_notify_signer');
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $function$;

-- ── 3. BEFORE UPDATE:重送(被駁→回待簽)→ current_step 歸 0 ────────────────────
CREATE OR REPLACE FUNCTION public._trg_hr_reset_step_on_resubmit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pending text;
BEGIN
  IF TG_TABLE_NAME IN ('leave_requests','overtime_requests','business_trips')
    THEN v_pending := '待審核';
    ELSE v_pending := '申請中';
  END IF;
  IF COALESCE(OLD.status,'') IN ('已駁回','已退回')
     AND NEW.status = v_pending
     AND NEW.approval_chain_id IS NOT NULL THEN
    NEW.current_step := 0;   -- 整條鏈從關0 重跑(step0 快照實測無 auto_skip → 安全)
  END IF;
  RETURN NEW;
END $function$;

-- ── 4. AFTER UPDATE:重送重新通知關0 + 駁回通知已簽人 ────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_hr_resubmit_reject_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_hr_a  boolean;
  v_pending  text;
  v_snap_rt  text;
  v_card_rt  text;
  v_applicant int;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.approval_chain_id IS NULL THEN RETURN NEW; END IF;

  v_is_hr_a := TG_TABLE_NAME IN ('leave_requests','overtime_requests','business_trips');
  v_pending := CASE WHEN v_is_hr_a THEN '待審核' ELSE '申請中' END;

  CASE TG_TABLE_NAME
    WHEN 'leave_requests'              THEN v_snap_rt:='leave_request';    v_card_rt:='leave';       v_applicant:=NEW.employee_id;
    WHEN 'overtime_requests'           THEN v_snap_rt:='overtime_request'; v_card_rt:='overtime';    v_applicant:=NEW.employee_id;
    WHEN 'business_trips'              THEN v_snap_rt:='trip';             v_card_rt:='trip';
      v_applicant := (SELECT id FROM public.employees WHERE name = NEW.employee ORDER BY (status='在職') DESC NULLS LAST LIMIT 1);
    WHEN 'resignation_requests'        THEN v_snap_rt:='resignation';      v_card_rt:='resignation'; v_applicant:=NEW.employee_id;
    WHEN 'leave_of_absence_requests'   THEN v_snap_rt:='loa';              v_card_rt:='loa';         v_applicant:=NEW.employee_id;
    WHEN 'personnel_transfer_requests' THEN v_snap_rt:='transfer';         v_card_rt:='transfer';    v_applicant:=NEW.employee_id;
    WHEN 'headcount_requests'          THEN v_snap_rt:='headcount';        v_card_rt:='headcount';   v_applicant:=NEW.employee_id;
    ELSE RETURN NEW;
  END CASE;

  -- (A) 重送:被駁 → 回待簽 → 重新通知關0(BEFORE trigger 已把 current_step 歸0)
  IF COALESCE(OLD.status,'') IN ('已駁回','已退回') AND NEW.status = v_pending THEN
    IF v_is_hr_a THEN
      PERFORM public._notify_hr_request_approvers(v_card_rt, NEW.id, v_applicant);
    ELSE
      PERFORM public._notify_hr_b_step(v_snap_rt, NEW.id, 0);
    END IF;
    RETURN NEW;
  END IF;

  -- (B) 駁回:剛進入被駁 → 通知關0..被駁關-1 的已簽人(NEW.current_step = 被駁關)
  IF NEW.status IN ('已駁回','已退回') AND COALESCE(OLD.status,'') NOT IN ('已駁回','已退回') THEN
    PERFORM public._notify_hr_prior_signers_rejected(v_snap_rt, NEW.id, v_applicant, COALESCE(NEW.current_step,0));
    RETURN NEW;
  END IF;

  RETURN NEW;
END $function$;

-- ── 5. 掛 trigger 到 7 張表(先 DROP 再 CREATE,idempotent)────────────────────────
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'leave_requests','overtime_requests','business_trips',
    'resignation_requests','leave_of_absence_requests',
    'personnel_transfer_requests','headcount_requests'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_hr_reset_step_on_resubmit ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_hr_reset_step_on_resubmit BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._trg_hr_reset_step_on_resubmit()', t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_hr_resubmit_reject_notify ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_hr_resubmit_reject_notify AFTER UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._trg_hr_resubmit_reject_notify()', t);
  END LOOP;
END $do$;

NOTIFY pgrst, 'reload schema';
