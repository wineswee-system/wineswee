-- ============================================================
-- 升級簽核鏈 LINE Flex 卡片：加入類型 / 申請人 / 金額 / 科目 / 說明 / 簽核進度列表
--
-- 對齊 20260507210000_task_chain_unified_db_trigger.sql 的 _push_task_chain_flex
-- 不改 trigger 邏輯，只升級 helper 與 flex payload；行為相容。
-- ============================================================

BEGIN;

-- ═══ 1. helper：解任務在簽核鏈中的 rich meta（一次取齊） ═══
CREATE OR REPLACE FUNCTION public._resolve_task_chain_meta(p_task_id int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_task        tasks;
  v_er          expense_requests;
  v_type_label  text;
  v_type_color  text;
  v_applicant   text;
  v_dept        text;
  v_store       text;
  v_app_line    text;
  v_amount      text;
  v_account     text;
  v_description text;
  v_signed      jsonb := '[]'::jsonb;
  v_pending     jsonb := '[]'::jsonb;
  v_total       int;
BEGIN
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- 經費 chain：用 approval_chain_id 反查 expense_requests
  IF v_task.approval_chain_id IS NOT NULL THEN
    SELECT * INTO v_er FROM expense_requests er
     WHERE er.approval_chain_id = v_task.approval_chain_id
       AND (er.organization_id = v_task.organization_id
            OR er.organization_id IS NULL
            OR v_task.organization_id IS NULL)
     ORDER BY er.created_at DESC
     LIMIT 1;
  END IF;

  -- 類型 + 顏色（無確認 convention 前用關鍵字 best-effort）
  IF v_er.id IS NOT NULL THEN
    v_type_label := '經費'; v_type_color := '#f97316';
  ELSIF COALESCE(v_task.category, '') ~* '(人事|hr|leave|請假|離職|異動|轉調)'
     OR COALESCE(v_task.bucket,   '') ~* '(人事|hr)' THEN
    v_type_label := '人事'; v_type_color := '#3b82f6';
  ELSIF COALESCE(v_task.category, '') ~* '(排班|班表|shift|調班|加班)'
     OR COALESCE(v_task.bucket,   '') ~* '(排班|shift)' THEN
    v_type_label := '排班'; v_type_color := '#a855f7';
  ELSE
    v_type_label := '一般'; v_type_color := '#6b7280';
  END IF;

  -- 申請人 / 部門 / 店別
  IF v_er.id IS NOT NULL THEN
    v_applicant := v_er.employee;
    v_dept      := v_er.department;
    v_store     := v_er.store;
  ELSE
    v_applicant := COALESCE(NULLIF(v_task.created_by, ''), v_task.assignee);
    SELECT e.department INTO v_dept
      FROM employees e
     WHERE e.name = v_applicant
       AND (e.organization_id = v_task.organization_id OR v_task.organization_id IS NULL)
     LIMIT 1;
    v_store := v_task.store;
    IF (v_store IS NULL OR v_store = '') AND v_task.store_id IS NOT NULL THEN
      SELECT s.name INTO v_store FROM stores s WHERE s.id = v_task.store_id;
    END IF;
  END IF;

  v_app_line := array_to_string(
    ARRAY(
      SELECT x FROM unnest(ARRAY[v_applicant, v_dept, v_store]) AS x
       WHERE x IS NOT NULL AND btrim(x) <> ''
    ),
    ' · '
  );
  IF v_app_line = '' THEN v_app_line := NULL; END IF;

  -- 金額 + 會計科目（僅經費）
  IF v_er.id IS NOT NULL AND v_er.estimated_amount IS NOT NULL THEN
    v_amount := 'NT$ ' || to_char(v_er.estimated_amount, 'FM999,999,999');
  END IF;
  IF v_er.id IS NOT NULL THEN
    IF NULLIF(v_er.account_name,'') IS NOT NULL AND NULLIF(v_er.account_code,'') IS NOT NULL THEN
      v_account := v_er.account_name || ' (' || v_er.account_code || ')';
    ELSE
      v_account := COALESCE(NULLIF(v_er.account_name,''), NULLIF(v_er.account_code,''));
    END IF;
  END IF;

  -- 說明：經費優先用 expense_requests.description，否則 tasks.description / notes
  v_description := COALESCE(
    NULLIF(v_er.description, ''),
    NULLIF(v_task.description, ''),
    NULLIF(v_task.notes, '')
  );
  IF v_description IS NOT NULL AND char_length(v_description) > 80 THEN
    v_description := left(v_description, 78) || '…';
  END IF;

  -- 鏈關卡總數
  IF v_task.approval_chain_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_total FROM approval_chain_steps WHERE chain_id = v_task.approval_chain_id;
  END IF;

  -- 已處理（approved / rejected）
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'step_order')::int, (row->>'time') NULLS LAST), '[]'::jsonb)
    INTO v_signed
    FROM (
      SELECT jsonb_build_object(
        'step_order', step_order,
        'step',       step_order + 1,
        'name',       approver,
        'time',       to_char(responded_at, 'FMMM/FMDD HH24:MI'),
        'status',     status
      ) AS row
        FROM task_confirmations
       WHERE task_id = p_task_id AND status IN ('approved','rejected')
    ) s;

  -- 待簽核（pending）
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'step_order')::int, (row->>'id')::int), '[]'::jsonb)
    INTO v_pending
    FROM (
      SELECT jsonb_build_object(
        'step_order', step_order,
        'step',       step_order + 1,
        'name',       approver,
        'id',         id
      ) AS row
        FROM task_confirmations
       WHERE task_id = p_task_id AND status = 'pending'
    ) p;

  RETURN jsonb_build_object(
    'type_label',     v_type_label,
    'type_color',     v_type_color,
    'applicant_line', v_app_line,
    'amount',         v_amount,
    'account',        v_account,
    'description',    v_description,
    'signed',         v_signed,
    'pending',        v_pending,
    'total_steps',    v_total
  );
END $$;

GRANT EXECUTE ON FUNCTION public._resolve_task_chain_meta(int) TO authenticated, service_role;


-- ═══ 2. helper：構建 meta row（label flex:0 + value flex:5 wrap） ═══
CREATE OR REPLACE FUNCTION public._chain_meta_row(p_label text, p_value text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'type', 'box', 'layout', 'horizontal', 'spacing', 'md',
    'contents', jsonb_build_array(
      jsonb_build_object('type','text','text',p_label,'size','xs','color','#888888','flex',0),
      jsonb_build_object('type','text','text',p_value,'size','xs','color','#222222','flex',5,'wrap',true)
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public._chain_meta_row(text, text) TO authenticated, service_role;


-- ═══ 3. 重建 _push_task_chain_flex：加入新 sections + 第 9 個 optional 參數 ═══
-- 參數新增：p_recipient_approver text（用來在「⏳ 第N關 名字」那行標 ← 您）
DROP FUNCTION IF EXISTS public._push_task_chain_flex(text, text, int, text, text, int, int, text);

CREATE OR REPLACE FUNCTION public._push_task_chain_flex(
  p_line_user_id        text,
  p_liff_id             text,
  p_task_id             int,
  p_task_title          text,
  p_step_label          text,
  p_step_order          int,
  p_chain_total         int,
  p_event               text,    -- 'step_assigned' | 'task_done' | 'task_rejected'
  p_recipient_approver  text DEFAULT NULL
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
  v_meta       jsonb;
  v_body       jsonb := '[]'::jsonb;
  v_step_text  text;
  v_step_color text;
  r            jsonb;
  v_step_subtitle text;
  v_payload    jsonb;
BEGIN
  IF p_line_user_id IS NULL OR p_line_user_id = '' THEN RETURN; END IF;

  -- 顏色 / 標題 by event
  IF p_event = 'task_done' THEN
    v_color := '#22c55e'; v_header := '✅ 簽核完成';
    v_alt_text := '簽核完成：' || COALESCE(p_task_title, '');
  ELSIF p_event = 'task_rejected' THEN
    v_color := '#ef4444'; v_header := '❌ 簽核退回';
    v_alt_text := '簽核退回：' || COALESCE(p_task_title, '');
  ELSE
    v_color := '#06b6d4'; v_header := '🔐 待您簽核';
    v_alt_text := '待簽核：' || COALESCE(p_task_title, '');
  END IF;

  -- LIFF deep-link
  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
                  || '?to=%2Ftasks%3Ftask%3D' || p_task_id::text;
  END IF;

  v_meta := public._resolve_task_chain_meta(p_task_id);

  -- (1) 標題
  v_body := v_body || jsonb_build_array(
    jsonb_build_object('type','text','text',COALESCE(p_task_title,''),'weight','bold','size','md','wrap',true)
  );

  -- (2) 類型 pill + step 副標
  v_step_subtitle := CASE
    WHEN p_event = 'step_assigned' AND p_chain_total IS NOT NULL THEN
      COALESCE(p_step_label,'') || ' (' || (COALESCE(p_step_order,0) + 1) || '/' || p_chain_total || ')'
    WHEN p_event = 'step_assigned' THEN COALESCE(p_step_label,'')
    WHEN p_event = 'task_done'     THEN '所有簽核關卡已通過'
    ELSE                                '簽核已退回'
  END;

  v_body := v_body || jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','spacing','md','margin','sm','alignItems','center',
      'contents', jsonb_build_array(
        jsonb_build_object(
          'type','box','layout','vertical','flex',0,
          'backgroundColor', v_meta->>'type_color',
          'cornerRadius','6px',
          'paddingTop','4px','paddingBottom','4px','paddingStart','10px','paddingEnd','10px',
          'contents', jsonb_build_array(
            jsonb_build_object('type','text','text',COALESCE(v_meta->>'type_label','一般'),
                               'color','#FFFFFF','size','xs','weight','bold','align','center')
          )
        ),
        jsonb_build_object('type','text','text',v_step_subtitle,
                           'size','xs','color','#666666','flex',1,'gravity','center','wrap',true)
      )
    ),
    jsonb_build_object('type','separator','margin','md')
  );

  -- (3) Meta rows（缺值的略過）
  IF v_meta->>'applicant_line' IS NOT NULL THEN
    v_body := v_body || jsonb_build_array(public._chain_meta_row('👤 申請人', v_meta->>'applicant_line'));
  END IF;
  IF v_meta->>'amount' IS NOT NULL THEN
    v_body := v_body || jsonb_build_array(public._chain_meta_row('💰 金額', v_meta->>'amount'));
  END IF;
  IF v_meta->>'account' IS NOT NULL THEN
    v_body := v_body || jsonb_build_array(public._chain_meta_row('📂 科目', v_meta->>'account'));
  END IF;
  IF v_meta->>'description' IS NOT NULL THEN
    v_body := v_body || jsonb_build_array(public._chain_meta_row('📝 說明', v_meta->>'description'));
  END IF;

  -- (4) 簽核進度列表（只有 chain task 才有，否則略過）
  IF jsonb_array_length(v_meta->'signed') > 0 OR jsonb_array_length(v_meta->'pending') > 0 THEN
    v_body := v_body || jsonb_build_array(jsonb_build_object('type','separator','margin','md'));

    -- 已處理
    FOR r IN SELECT jsonb_array_elements(v_meta->'signed')
    LOOP
      IF (r->>'status') = 'rejected' THEN
        v_step_text  := '❌ 第' || (r->>'step') || '關 ' || (r->>'name') || ' · ' || COALESCE(r->>'time','');
        v_step_color := '#ef4444';
      ELSE
        v_step_text  := '✅ 第' || (r->>'step') || '關 ' || (r->>'name') || ' · ' || COALESCE(r->>'time','');
        v_step_color := '#374151';
      END IF;
      v_body := v_body || jsonb_build_array(
        jsonb_build_object('type','text','text',v_step_text,'size','xs','color',v_step_color,'wrap',true)
      );
    END LOOP;

    -- 待簽核
    FOR r IN SELECT jsonb_array_elements(v_meta->'pending')
    LOOP
      v_step_text := '⏳ 第' || (r->>'step') || '關 ' || (r->>'name');
      IF p_recipient_approver IS NOT NULL AND (r->>'name') = p_recipient_approver THEN
        v_step_text := v_step_text || ' ← 您';
      END IF;
      v_body := v_body || jsonb_build_array(
        jsonb_build_object('type','text','text',v_step_text,'size','xs','color','#9ca3af','wrap',true)
      );
    END LOOP;
  END IF;

  v_payload := jsonb_build_object(
    'to', p_line_user_id,
    'messages', jsonb_build_array(
      jsonb_build_object(
        'type','flex','altText',v_alt_text,
        'contents', jsonb_build_object(
          'type','bubble','size','mega',
          'header', jsonb_build_object(
            'type','box','layout','vertical','paddingAll','14px','backgroundColor',v_color,
            'contents', jsonb_build_array(
              jsonb_build_object('type','text','text',v_header,'color','#FFFFFF','weight','bold','size','md')
            )
          ),
          'body', jsonb_build_object(
            'type','box','layout','vertical','spacing','sm','paddingAll','14px',
            'contents', v_body
          ),
          'footer', jsonb_build_object(
            'type','box','layout','vertical','spacing','sm','paddingAll','14px',
            'contents', CASE
              WHEN v_liff_url IS NOT NULL THEN jsonb_build_array(
                jsonb_build_object(
                  'type','button','style','primary','color',v_color,'height','sm',
                  'action', jsonb_build_object('type','uri','label','🔍 查看任務','uri',v_liff_url)
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
      'Content-Type','application/json',
      'Authorization','Bearer ' || v_anon
    ),
    timeout_milliseconds := 8000
  );
END $$;

GRANT EXECUTE ON FUNCTION public._push_task_chain_flex(text, text, int, text, text, int, int, text, text) TO authenticated, service_role;


-- ═══ 4. 升級 INSERT trigger：把 NEW.approver 帶過去當 recipient（標 ← 您） ═══
CREATE OR REPLACE FUNCTION public._notify_task_confirmation_inserted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_task         tasks;
  v_chain_total  int;
  v_step_label   text;
  v_line_uid     text;
  v_liff_id      text;
BEGIN
  IF current_setting('app.skip_chain_notify', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  SELECT * INTO v_task FROM tasks WHERE id = NEW.task_id;
  IF v_task.id IS NULL THEN RETURN NEW; END IF;
  IF v_task.approval_chain_id IS NULL THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_chain_total
    FROM approval_chain_steps WHERE chain_id = v_task.approval_chain_id;

  SELECT '第 ' || (NEW.step_order + 1)::text || ' 關：' || COALESCE(label, role_name, '審核')
    INTO v_step_label
    FROM approval_chain_steps
   WHERE chain_id = v_task.approval_chain_id AND step_order = NEW.step_order;

  SELECT v.line_user_id, v.liff_id
    INTO v_line_uid, v_liff_id
    FROM v_employee_line_resolved v
    JOIN employees e ON e.id = v.employee_id
   WHERE e.name = NEW.approver
     AND (e.organization_id = v_task.organization_id OR v_task.organization_id IS NULL)
   ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
   LIMIT 1;

  IF v_line_uid IS NULL THEN RETURN NEW; END IF;

  PERFORM public._push_task_chain_flex(
    v_line_uid, v_liff_id, v_task.id, v_task.title,
    v_step_label, NEW.step_order, v_chain_total, 'step_assigned',
    NEW.approver
  );

  RETURN NEW;
END $$;


COMMIT;
