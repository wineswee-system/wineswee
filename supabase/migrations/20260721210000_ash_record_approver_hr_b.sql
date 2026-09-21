-- 補記「誰簽的」— HR B 類(離職/留停/異動/人力需求)簽核軌跡記名 — 2026-07-21
-- ════════════════════════════════════════════════════════════════════════════
-- 問題:approval_step_history(ASH) 靠 _trg_ash_record_chain_step 從 request row 的
--   approver/approved_by「文字欄」反查簽核人。但 HR B 表(resignation_requests 等)
--   ★沒有 approver/approved_by 文字欄★(只有 approver_id int),且 hr_chain_approve 中間關
--   推進只 current_step+1 不帶簽核人 → ASH.approver_id 全 NULL(離職 0/3)。
--   → 勞資稽核時「誰核准了離職」在系統查無此人。
--
-- 修法(GUC 傳遞,不污染 approver_id 欄語意):
--   1. hr_chain_approve 開頭 set_config('app.ash_approver_id', p_approver_id, true)
--      (transaction-local,只此 RPC 設 → 只影響 HR B 的 ASH 寫入)
--   2. _trg_ash_record_chain_step 讀該 GUC 為當關簽核人(補上中間關+終態關)
--   其餘 request 類型(leave/overtime/expense 走 approved_by/approver 文字欄)GUC 未設 → 行為不變。
--
-- 註:歷史 3 筆(#2/#3/#4)中間關實際簽核人已遺失(當時沒記),無法回填,不臆造。往後新單即有軌跡。
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. ASH trigger:讀 GUC 當關簽核人 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_ash_record_chain_step()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rt          text;
  v_new_json    jsonb;
  v_old_json    jsonb;
  v_step_label  text;
  v_target_type text;
  v_approver    text;
  v_approver_id int;
  v_action      text;
  v_chain_id    int;
BEGIN
  v_rt := CASE TG_TABLE_NAME
    WHEN 'leave_requests'                  THEN 'leave'
    WHEN 'overtime_requests'               THEN 'overtime'
    WHEN 'business_trips'                  THEN 'trip'
    WHEN 'clock_corrections'               THEN 'correction'
    WHEN 'expenses'                        THEN 'expense'
    WHEN 'expense_requests'                THEN 'expense_request'
    WHEN 'resignation_requests'            THEN 'resignation'
    WHEN 'leave_of_absence_requests'       THEN 'loa'
    WHEN 'personnel_transfer_requests'     THEN 'transfer'
    WHEN 'headcount_requests'              THEN 'headcount'
    WHEN 'form_submissions'                THEN 'form_submission'
    ELSE NULL
  END;
  IF v_rt IS NULL THEN RETURN NEW; END IF;

  v_new_json := to_jsonb(NEW);

  IF v_rt = 'form_submission' THEN
    SELECT approval_chain_id INTO v_chain_id
      FROM form_templates WHERE id = (v_new_json->>'template_id')::int;
  ELSE
    v_chain_id := NULLIF(v_new_json->>'approval_chain_id', '')::int;
  END IF;

  -- INSERT：起手寫第一筆 entered
  IF TG_OP = 'INSERT' AND v_chain_id IS NOT NULL THEN
    SELECT label, target_type INTO v_step_label, v_target_type
      FROM approval_chain_steps
     WHERE chain_id = v_chain_id
       AND step_order = COALESCE((v_new_json->>'current_step')::int, 0)
     LIMIT 1;

    INSERT INTO approval_step_history (
      request_type, request_id, organization_id, chain_id,
      step_order, step_label, target_type, entered_at, action
    ) VALUES (
      v_rt,
      (v_new_json->>'id')::int,
      NULLIF(v_new_json->>'organization_id','')::int,
      v_chain_id,
      COALESCE((v_new_json->>'current_step')::int, 0),
      v_step_label, v_target_type,
      now(), 'submitted'
    );
    RETURN NEW;
  END IF;

  v_approver := COALESCE(v_new_json->>'approver', v_new_json->>'approved_by');

  -- 用 name + org_id 反查 emp_id
  IF v_approver IS NOT NULL AND v_approver NOT LIKE '%系統%' AND v_approver NOT LIKE '%自動%' THEN
    SELECT id INTO v_approver_id FROM employees
     WHERE name = v_approver
       AND (NULLIF(v_new_json->>'organization_id','')::int IS NULL
            OR organization_id = (v_new_json->>'organization_id')::int)
     LIMIT 1;

    -- ★ fallback：org_id 不符時去掉篩選再查一次
    IF v_approver_id IS NULL THEN
      SELECT id INTO v_approver_id FROM employees
       WHERE name = v_approver
       LIMIT 1;
    END IF;
  END IF;

  -- form_submissions 沒「approver」字串只有 approver_id；直接用整數欄
  IF v_rt = 'form_submission' AND v_approver_id IS NULL THEN
    v_approver_id := NULLIF(v_new_json->>'approver_id', '')::int;
    IF v_approver_id IS NOT NULL THEN
      SELECT name INTO v_approver FROM employees WHERE id = v_approver_id;
    END IF;
  END IF;

  -- ★ GUC 優先(2026-07-21)：推進 RPC(hr_chain_approve)明確傳入的當關簽核人。
  --   HR B 表無 approver/approved_by 文字欄 → 靠此補記名(含中間關與終態關)。
  --   transaction-local GUC,僅 hr_chain_approve 設 → 不影響其他 request 類型。
  IF NULLIF(current_setting('app.ash_approver_id', true), '') IS NOT NULL THEN
    v_approver_id := current_setting('app.ash_approver_id', true)::int;
    SELECT name INTO v_approver FROM employees WHERE id = v_approver_id;
  END IF;

  v_old_json := to_jsonb(OLD);

  -- UPDATE OF current_step：上一關 exit + 新關 entered
  IF TG_OP = 'UPDATE'
     AND (v_new_json->>'current_step') IS DISTINCT FROM (v_old_json->>'current_step')
     AND v_chain_id IS NOT NULL THEN
    UPDATE approval_step_history
       SET exited_at = now(),
           action = CASE
             WHEN (v_new_json->>'status') IN ('已退回','已駁回') THEN 'rejected'
             ELSE 'approved'
           END,
           approver_name = COALESCE(v_approver, approver_name),
           approver_id   = COALESCE(v_approver_id, approver_id)
     WHERE request_type = v_rt
       AND request_id = (v_new_json->>'id')::int
       AND step_order = COALESCE((v_old_json->>'current_step')::int, 0)
       AND exited_at IS NULL;

    SELECT label, target_type INTO v_step_label, v_target_type
      FROM approval_chain_steps
     WHERE chain_id = v_chain_id
       AND step_order = (v_new_json->>'current_step')::int
     LIMIT 1;

    IF v_step_label IS NOT NULL THEN
      INSERT INTO approval_step_history (
        request_type, request_id, organization_id, chain_id,
        step_order, step_label, target_type, entered_at, action
      ) VALUES (
        v_rt,
        (v_new_json->>'id')::int,
        NULLIF(v_new_json->>'organization_id','')::int,
        v_chain_id,
        (v_new_json->>'current_step')::int,
        v_step_label, v_target_type,
        now(), 'pending'
      );
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE OF status：終態關 exit
  IF TG_OP = 'UPDATE'
     AND (v_new_json->>'status') IS DISTINCT FROM (v_old_json->>'status')
     AND (v_new_json->>'status') IN ('已核准','已核銷','已退回','已駁回','已拒絕') THEN
    v_action := CASE (v_new_json->>'status')
      WHEN '已核准' THEN 'approved'
      WHEN '已核銷' THEN 'approved'
      WHEN '已退回' THEN 'rejected'
      WHEN '已駁回' THEN 'rejected'
      WHEN '已拒絕' THEN 'rejected'
    END;
    UPDATE approval_step_history
       SET exited_at = now(),
           action = v_action,
           approver_name = COALESCE(v_approver, approver_name),
           approver_id   = COALESCE(v_approver_id, approver_id)
     WHERE request_type = v_rt
       AND request_id = (v_new_json->>'id')::int
       AND exited_at IS NULL;
  END IF;

  RETURN NEW;
END $function$;

-- ── 2. hr_chain_approve:開頭把當關簽核人塞進 GUC ────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_chain_approve(p_table text, p_id integer, p_approver_id integer, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table_name        TEXT;
  v_snap_request_type TEXT;
  v_record            RECORD;
  v_chain_id          INT;
  v_cur_step          INT;
  v_total_steps       INT;
  v_step              approval_chain_steps;
  v_is_last           BOOLEAN;
  v_next_step         approval_chain_steps;
  v_next_ids          INT[];
  v_next_json         JSON;
  v_extra             approval_extra_steps;
  v_has_snapshot      BOOLEAN;
  v_matches           BOOLEAN;
BEGIN
  -- ★ 把當關簽核人傳給 ASH trigger(HR B 表無 approver 文字欄) — 2026-07-21
  PERFORM set_config('app.ash_approver_id', p_approver_id::text, true);

  v_table_name := CASE p_table
    WHEN 'resignation' THEN 'resignation_requests'
    WHEN 'loa'         THEN 'leave_of_absence_requests'
    WHEN 'transfer'    THEN 'personnel_transfer_requests'
    WHEN 'headcount'   THEN 'headcount_requests'
    ELSE NULL
  END;
  IF v_table_name IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_TABLE');
  END IF;

  -- snapshot request_type
  v_snap_request_type := p_table;  -- 'resignation' / 'loa' / 'transfer' / 'headcount' 對齊

  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_ACTION');
  END IF;
  IF p_action = 'reject' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RETURN json_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  EXECUTE format('SELECT id, approval_chain_id, current_step, status, employee_id, organization_id FROM %I WHERE id = $1', v_table_name)
    INTO v_record USING p_id;

  IF v_record.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF v_record.status <> '申請中' THEN
    RETURN json_build_object('ok', false, 'error', 'ALREADY_PROCESSED');
  END IF;

  v_chain_id := v_record.approval_chain_id;
  v_cur_step := v_record.current_step;

  -- 加簽 guard
  v_extra := public.get_pending_extra_step(v_table_name, p_id, COALESCE(v_cur_step, 0));
  IF v_extra.id IS NOT NULL THEN
    RETURN json_build_object(
      'ok', false, 'error', 'PENDING_EXTRA_SIGNER',
      'extra_step_id', v_extra.id, 'extra_assignee_id', v_extra.assignee_id,
      'message', '此單據有加簽請求進行中，請等加簽人完成後再簽核'
    );
  END IF;

  -- 沒 chain → 舊行為
  IF v_chain_id IS NULL THEN
    IF p_action = 'approve' THEN
      EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW() WHERE id=$3', v_table_name)
        USING '已核准', p_approver_id, p_id;
      RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved_no_chain');
    ELSE
      EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW(), reject_reason=$3 WHERE id=$4', v_table_name)
        USING '已駁回', p_approver_id, btrim(p_reason), p_id;
      RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected_no_chain');
    END IF;
  END IF;

  -- snapshot 優先
  SELECT EXISTS (
    SELECT 1 FROM public.request_chain_snapshots
     WHERE request_type = v_snap_request_type AND request_id = p_id
  ) INTO v_has_snapshot;

  IF v_has_snapshot THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.request_chain_snapshots
       WHERE request_type = v_snap_request_type AND request_id = p_id AND step_order = v_cur_step
    ) THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND', 'source', 'snapshot');
    END IF;

    SELECT public._employee_matches_snapshot_step(
      p_approver_id, v_snap_request_type, p_id, v_cur_step, v_record.employee_id
    ) INTO v_matches;

    SELECT COUNT(*) INTO v_total_steps
      FROM public.request_chain_snapshots
     WHERE request_type = v_snap_request_type AND request_id = p_id;
  ELSE
    SELECT * INTO v_step FROM approval_chain_steps
     WHERE chain_id = v_chain_id AND step_order = v_cur_step;
    IF v_step.id IS NULL THEN
      RETURN json_build_object('ok', false, 'error', 'CHAIN_STEP_NOT_FOUND', 'source', 'live_chain');
    END IF;
    SELECT public._employee_matches_chain_step(p_approver_id, v_step.id, v_record.employee_id)
      INTO v_matches;
    SELECT COUNT(*) INTO v_total_steps FROM approval_chain_steps WHERE chain_id = v_chain_id;
  END IF;

  IF NOT v_matches THEN
    RETURN json_build_object('ok', false, 'error', 'NOT_YOUR_TURN');
  END IF;

  v_is_last := (v_cur_step + 1 >= v_total_steps);

  IF p_action = 'reject' THEN
    EXECUTE format('UPDATE %I SET status=$1, reject_reason=$2, approver_id=$3 WHERE id=$4', v_table_name)
      USING '已駁回', btrim(p_reason), p_approver_id, p_id;
    RETURN json_build_object('ok', true, 'status', '已駁回', 'event', 'rejected', 'rejected_at_step', v_cur_step);
  END IF;

  IF v_is_last THEN
    EXECUTE format('UPDATE %I SET status=$1, approver_id=$2, approved_at=NOW() WHERE id=$3', v_table_name)
      USING '已核准', p_approver_id, p_id;
    RETURN json_build_object('ok', true, 'status', '已核准', 'event', 'approved', 'is_last_step', true);
  ELSE
    EXECUTE format('UPDATE %I SET current_step=current_step+1 WHERE id=$1', v_table_name) USING p_id;

    -- 下關 approver（snapshot 優先）
    IF v_has_snapshot THEN
      SELECT json_agg(json_build_object('emp_id', a.emp_id, 'name', a.emp_name))
        INTO v_next_json
        FROM public.resolve_snapshot_step_approvers(
          v_snap_request_type, p_id, v_cur_step + 1, v_record.employee_id
        ) a;
    ELSE
      SELECT * INTO v_next_step FROM approval_chain_steps
       WHERE chain_id = v_chain_id AND step_order = v_cur_step + 1;
      SELECT array_agg(e.id) INTO v_next_ids FROM employees e
       WHERE e.status='在職' AND e.organization_id = v_record.organization_id
         AND public._employee_matches_chain_step(e.id, v_next_step.id, v_record.employee_id);
      SELECT json_agg(json_build_object('emp_id', id, 'name', name)) INTO v_next_json
        FROM employees WHERE id = ANY(COALESCE(v_next_ids, ARRAY[]::INT[]));
    END IF;

    RETURN json_build_object('ok', true, 'status', '簽核中', 'event', 'advanced',
      'advanced_to_step', v_cur_step + 1, 'is_last_step', false,
      'next_approvers', COALESCE(v_next_json, '[]'::json));
  END IF;
END
$function$;

NOTIFY pgrst, 'reload schema';
