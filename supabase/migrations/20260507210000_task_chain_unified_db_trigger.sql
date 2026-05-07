-- ============================================================
-- 任務簽核鏈統一架構：全部走 task_confirmations + DB trigger 推進 + 直推 LINE
--
-- 解決問題：
--   1. 之前 web 走 approval_forms（前端推進邏輯有 bug，第二關沒推到）
--   2. LIFF 走 task_confirmations（trigger 推進沒問題）但通知靠 client → 不可靠
--   3. 跨 surface 不一致 → 修一邊忘另一邊
--
-- 改完後：
--   - 任何來源（web RPC / LIFF RPC / 直接 SQL）建 task_confirmations → trigger 推 LINE
--   - 任何來源 update task_confirmations.status='approved' → trigger 推進 + 推下一關 LINE
--   - 全部過完 → trigger 推任務負責人「完成」LINE
--
-- 對齊 supabase/migrations/20260429000008_direct_line_push_trigger.sql 的 pattern：
-- trigger 用 net.http_post → line-push Edge Function（fire-and-forget，不阻塞 TX）
-- ============================================================

BEGIN;

-- ═══ 1. helper：給一個 employee 推一張簽核 flex 卡 ═══
-- 用 line-push Edge Function（已存在），payload { to, messages }
CREATE OR REPLACE FUNCTION public._push_task_chain_flex(
  p_line_user_id text,
  p_liff_id      text,
  p_task_id      int,
  p_task_title   text,
  p_step_label   text,    -- '第 1 關：直屬主管' 之類
  p_step_order   int,
  p_chain_total  int,
  p_event        text     -- 'step_assigned' | 'task_done' | 'task_rejected'
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
  ELSE  -- step_assigned
    v_color := '#06b6d4'; v_header := '🔐 待您簽核';
    v_alt_text := '待簽核：' || COALESCE(p_task_title, '');
  END IF;

  -- LIFF deep-link 到任務頁
  IF p_liff_id IS NOT NULL AND p_liff_id <> '' THEN
    v_liff_url := 'https://liff.line.me/' || p_liff_id
                  || '?to=%2Ftasks%3Ftask%3D' || p_task_id::text;
  END IF;

  v_payload := jsonb_build_object(
    'to', p_line_user_id,
    'messages', jsonb_build_array(
      jsonb_build_object(
        'type', 'flex',
        'altText', v_alt_text,
        'contents', jsonb_build_object(
          'type', 'bubble', 'size', 'kilo',
          'header', jsonb_build_object(
            'type', 'box', 'layout', 'vertical',
            'paddingAll', '14px', 'backgroundColor', v_color,
            'contents', jsonb_build_array(
              jsonb_build_object('type','text','text',v_header,'color','#FFFFFF','weight','bold','size','md')
            )
          ),
          'body', jsonb_build_object(
            'type', 'box', 'layout', 'vertical',
            'spacing', 'sm', 'paddingAll', '14px',
            'contents', jsonb_build_array(
              jsonb_build_object('type','text','text',COALESCE(p_task_title,''),'weight','bold','size','md','wrap',true),
              CASE
                WHEN p_event = 'step_assigned' AND p_chain_total IS NOT NULL THEN
                  jsonb_build_object('type','text','text',COALESCE(p_step_label,'') || ' (' || (p_step_order + 1) || '/' || p_chain_total || ')','size','xs','color','#666666','wrap',true)
                WHEN p_event = 'step_assigned' THEN
                  jsonb_build_object('type','text','text',COALESCE(p_step_label,''),'size','xs','color','#666666','wrap',true)
                WHEN p_event = 'task_done' THEN
                  jsonb_build_object('type','text','text','所有簽核關卡已通過','size','xs','color','#666666')
                ELSE
                  jsonb_build_object('type','text','text','簽核已退回，任務退回進行中','size','xs','color','#666666')
              END
            )
          ),
          'footer', jsonb_build_object(
            'type', 'box', 'layout', 'vertical',
            'spacing', 'sm', 'paddingAll', '14px',
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

GRANT EXECUTE ON FUNCTION public._push_task_chain_flex(text, text, int, text, text, int, int, text) TO authenticated, service_role;


-- ═══ 2. trigger AFTER INSERT on task_confirmations：通知該關 approvers ═══
-- 過渡期 opt-out：LIFF 老路徑（liff_complete_task_v2）client 會自己推 LINE，所以
-- 它呼 RPC 前會 SET LOCAL app.skip_chain_notify='true'，這個 trigger 看到就跳過。
-- LIFF JS 改完後可以把 opt-out 拿掉。
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
  -- 只通知 status='pending' 的（剛建的）；忽略其他狀態插入
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  SELECT * INTO v_task FROM tasks WHERE id = NEW.task_id;
  IF v_task.id IS NULL THEN RETURN NEW; END IF;

  -- chain 才推；無 chain 模式（單純 confirmation_required）的通知由其他現有 flow 處理
  IF v_task.approval_chain_id IS NULL THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_chain_total
    FROM approval_chain_steps WHERE chain_id = v_task.approval_chain_id;

  -- 取 step label
  SELECT '第 ' || (NEW.step_order + 1)::text || ' 關：' || COALESCE(label, role_name, '審核')
    INTO v_step_label
    FROM approval_chain_steps
   WHERE chain_id = v_task.approval_chain_id AND step_order = NEW.step_order;

  -- 解 line_user_id（依 approver 名字找 employee → v_employee_line_resolved）
  -- view 沒 organization_id，要 JOIN employees 拿才能避免跨 org 撞名
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
    v_step_label, NEW.step_order, v_chain_total, 'step_assigned'
  );

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_task_confirmation_inserted ON public.task_confirmations;
CREATE TRIGGER trg_notify_task_confirmation_inserted
  AFTER INSERT ON public.task_confirmations
  FOR EACH ROW EXECUTE FUNCTION public._notify_task_confirmation_inserted();


-- ═══ 3. 升級 trg_sync_task_confirmation_status：advance 後額外推 LINE ═══
-- 邏輯與原版一樣，多加：
--   - reject → 推任務負責人「task_rejected」
--   - 任務全部通過 → 推任務負責人「task_done」
--   - 推進到下一關 → 不需要在這裡推（_create_task_confirmations_for_step 會 INSERT，
--                    觸發 #2 的 INSERT trigger 推 step_assigned）
CREATE OR REPLACE FUNCTION public.trg_sync_task_confirmation_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total       INT;
  v_done        INT;
  v_rejected    INT;
  v_step        INT;
  v_task        tasks;
  v_chain_total INT;
  v_is_last     BOOLEAN;
  v_assignee_line text;
  v_assignee_liff text;
BEGIN
  v_step := NEW.step_order;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status IN ('approved','rejected')),
         COUNT(*) FILTER (WHERE status = 'rejected')
    INTO v_total, v_done, v_rejected
    FROM task_confirmations
   WHERE task_id = NEW.task_id AND step_order = v_step;

  IF v_total = 0 OR v_done < v_total THEN RETURN NEW; END IF;

  SELECT * INTO v_task FROM tasks WHERE id = NEW.task_id;

  -- 解任務負責人 LINE（推「完成 / 退回」結果用）
  SELECT v.line_user_id, v.liff_id
    INTO v_assignee_line, v_assignee_liff
    FROM v_employee_line_resolved v
   WHERE (v_task.assignee_id IS NOT NULL AND v.employee_id = v_task.assignee_id)
      OR (v_task.assignee_id IS NULL     AND v.employee_name = v_task.assignee)
   ORDER BY (v.channel_code = 'workflow') DESC, v.is_primary DESC NULLS LAST
   LIMIT 1;

  -- ★ rejected → task 退回，推任務負責人
  IF v_rejected > 0 THEN
    UPDATE tasks SET
      confirmation_status = 'rejected',
      confirmation_responded_at = NOW(),
      status = CASE WHEN status = '待確認' THEN '已退回' ELSE status END
    WHERE id = NEW.task_id;

    PERFORM public._push_task_chain_flex(
      v_assignee_line, v_assignee_liff, v_task.id, v_task.title,
      NULL, NULL, NULL, 'task_rejected'
    );
    RETURN NEW;
  END IF;

  -- 全部 approve
  IF v_task.approval_chain_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_chain_total FROM approval_chain_steps WHERE chain_id = v_task.approval_chain_id;
    v_is_last := (v_step + 1 >= v_chain_total);
    IF NOT v_is_last THEN
      -- 推進下一步：建下一 step 的 task_confirmations（INSERT trigger 會推 step_assigned LINE）
      PERFORM public._create_task_confirmations_for_step(
        v_task.id, v_task.approval_chain_id, v_step + 1, v_task.organization_id
      );
      RETURN NEW;
    END IF;
  END IF;

  -- 沒 chain 或最後一步 → 任務完成 + 推任務負責人
  UPDATE tasks SET
    confirmation_status = 'approved',
    confirmation_responded_at = NOW(),
    status       = CASE WHEN status = '待確認' THEN '已完成' ELSE status END,
    completed_at = CASE WHEN status = '待確認' THEN NOW() ELSE completed_at END
  WHERE id = NEW.task_id;

  PERFORM public._push_task_chain_flex(
    v_assignee_line, v_assignee_liff, v_task.id, v_task.title,
    NULL, NULL, NULL, 'task_done'
  );

  RETURN NEW;
END $$;


-- ═══ 4. 新 RPC web_complete_task：給 web 用（auth.uid() → employee → task）═══
CREATE OR REPLACE FUNCTION public.web_complete_task(
  p_task_id INT
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_emp          employees;
  v_task         tasks;
  v_has_pending  boolean;
  v_new_status   text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF v_emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO v_task FROM tasks
   WHERE id = p_task_id
     AND (assignee_id = v_emp.id OR assignee = v_emp.name);
  IF v_task.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_NOT_ASSIGNED');
  END IF;

  -- 若有 chain 且還沒任何 task_confirmations → 解 step 0 並建（INSERT trigger 推 LINE）
  IF v_task.approval_chain_id IS NOT NULL THEN
    PERFORM 1 FROM task_confirmations WHERE task_id = p_task_id LIMIT 1;
    IF NOT FOUND THEN
      PERFORM public._create_task_confirmations_for_step(
        p_task_id, v_task.approval_chain_id, 0, v_task.organization_id
      );
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM task_confirmations
    WHERE task_id = p_task_id AND status = 'pending'
  ) INTO v_has_pending;

  -- chain 模式但 step 0 解不出任何人 → 直接完成（避免卡死）
  IF v_task.approval_chain_id IS NOT NULL AND NOT v_has_pending THEN
    v_new_status := '已完成';
  ELSE
    v_new_status := CASE WHEN v_has_pending THEN '待確認' ELSE '已完成' END;
  END IF;

  UPDATE tasks SET
    status       = v_new_status,
    completed_at = CASE WHEN v_new_status = '已完成' THEN NOW() ELSE NULL END
  WHERE id = p_task_id;

  RETURN json_build_object(
    'ok', true,
    'task_id', p_task_id,
    'status', v_new_status,
    'has_pending_confirmations', v_has_pending,
    'task_title', v_task.title
  );
END $$;

GRANT EXECUTE ON FUNCTION public.web_complete_task(int) TO authenticated;


-- ═══ 5. 新 RPC web_approve_task_step：給 web/LIFF 都能用，update task_confirmations.status ═══
-- 簽核者按 web/LIFF 上的「核准 / 退回」按鈕都呼這個。
-- trigger 會自動處理推進 + 推 LINE。
CREATE OR REPLACE FUNCTION public.web_approve_task_step(
  p_task_id    INT,
  p_action     TEXT,    -- 'approve' | 'reject'
  p_reason     TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_emp          employees;
  v_conf_id      int;
  v_new_status   text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR p_reason = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_emp FROM employees WHERE auth_user_id = v_uid LIMIT 1;
  IF v_emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 找這個員工在這 task 的 pending confirmation
  SELECT id INTO v_conf_id FROM task_confirmations
   WHERE task_id = p_task_id AND approver = v_emp.name AND status = 'pending'
   LIMIT 1;
  IF v_conf_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_PENDING_CONFIRMATION');
  END IF;

  v_new_status := CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END;

  UPDATE task_confirmations SET
    status       = v_new_status,
    notes        = p_reason,
    responded_at = NOW()
  WHERE id = v_conf_id;
  -- trigger trg_sync_task_confirmation_status 會接手做推進 + 推 LINE

  RETURN json_build_object('ok', true, 'task_id', p_task_id, 'action', p_action);
END $$;

GRANT EXECUTE ON FUNCTION public.web_approve_task_step(int, text, text) TO authenticated;


-- ═══ 6. 過渡期：LIFF 兩個觸發 chain 的 RPC 加 opt-out flag ═══
-- LIFF JS 還會自己 push LINE，所以這兩個 RPC 內部 SET LOCAL skip_chain_notify=true，
-- 讓 INSERT trigger 不再重複推。等 LIFF JS 拿掉 client 推送邏輯，就可以把這個 SET 移除。
CREATE OR REPLACE FUNCTION public.liff_complete_task_v2(
  p_line_user_id text,
  p_task_id      int
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp           employees;
  task_row      tasks;
  has_pending   boolean;
  v_approvers   json := '[]'::json;
  new_status    text;
BEGIN
  -- 過渡期 opt-out：LIFF JS 自己會推 LINE，trigger 跳過避免雙推
  PERFORM set_config('app.skip_chain_notify', 'true', true);

  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  SELECT * INTO task_row FROM public.tasks
   WHERE id = p_task_id AND assignee_id = emp.id;
  IF task_row.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_NOT_ASSIGNED');
  END IF;

  IF task_row.approval_chain_id IS NOT NULL THEN
    PERFORM 1 FROM task_confirmations WHERE task_id = p_task_id LIMIT 1;
    IF NOT FOUND THEN
      v_approvers := public._create_task_confirmations_for_step(
        p_task_id, task_row.approval_chain_id, 0, task_row.organization_id
      );
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM task_confirmations
    WHERE task_id = p_task_id AND status = 'pending'
  ) INTO has_pending;

  IF task_row.approval_chain_id IS NOT NULL AND NOT has_pending THEN
    new_status := '已完成';
  ELSE
    new_status := CASE WHEN has_pending THEN '待確認' ELSE '已完成' END;
  END IF;

  UPDATE tasks SET
    status       = new_status,
    completed_at = CASE WHEN new_status = '已完成' THEN NOW() ELSE NULL END
  WHERE id = p_task_id;

  IF v_approvers = '[]'::json AND has_pending THEN
    SELECT COALESCE(json_agg(json_build_object(
      'emp_id', e.id, 'name', e.name, 'line_user_id', e.line_user_id
    )), '[]'::json) INTO v_approvers
      FROM task_confirmations tc
      JOIN employees e ON e.name = tc.approver
        AND (e.organization_id = task_row.organization_id OR task_row.organization_id IS NULL)
     WHERE tc.task_id = p_task_id AND tc.status = 'pending';
  END IF;

  RETURN json_build_object(
    'ok', true,
    'task_id', p_task_id,
    'status', new_status,
    'has_pending_confirmations', has_pending,
    'approvers', v_approvers,
    'task_title', task_row.title
  );
END $$;


-- liff_respond_task_confirmation 同樣加 opt-out（LIFF JS 推完當前關回應後會自己拉下一關 approvers 推）
CREATE OR REPLACE FUNCTION public.liff_respond_task_confirmation(
  p_line_user_id text,
  p_id           int,
  p_action       text,
  p_notes        text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  emp employees;
  v_status text;
  n int;
BEGIN
  PERFORM set_config('app.skip_chain_notify', 'true', true);

  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_notes IS NULL OR btrim(p_notes) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  v_status := CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END;

  UPDATE task_confirmations
     SET status = v_status,
         notes = CASE WHEN p_action = 'reject' THEN btrim(p_notes) ELSE notes END,
         responded_at = NOW()
   WHERE id = p_id
     AND approver = emp.name
     AND status = 'pending'
     AND (organization_id IS NULL OR organization_id = emp.organization_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND_OR_ALREADY_PROCESSED');
  END IF;
  RETURN json_build_object('ok', true, 'status', v_status);
END $$;


COMMIT;
