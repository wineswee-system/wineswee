-- 修:簽核歷程 trigger 記「關名/target」時改優先讀凍結快照(request_chain_snapshots),
-- 沒快照才 fallback 現行鏈。→ 鏈中途改(刪/換關)時,歷程標籤不再對不上人,也不會漏建待簽列。
-- (路由已用凍結快照;本檔把 audit 軌跡也對齊,徹底免疫中途改鏈。)

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
  v_snap_rt     text;
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

  -- 快照 request_type(與 v_rt 大多相同,只有 leave/overtime 命名不同)
  v_snap_rt := CASE v_rt
    WHEN 'leave'    THEN 'leave_request'
    WHEN 'overtime' THEN 'overtime_request'
    ELSE v_rt
  END;

  v_new_json := to_jsonb(NEW);

  IF v_rt = 'form_submission' THEN
    SELECT approval_chain_id INTO v_chain_id
      FROM form_templates WHERE id = (v_new_json->>'template_id')::int;
  ELSE
    v_chain_id := NULLIF(v_new_json->>'approval_chain_id', '')::int;
  END IF;

  -- INSERT：起手寫第一筆 entered
  IF TG_OP = 'INSERT' AND v_chain_id IS NOT NULL THEN
    -- 標籤優先讀凍結快照(鏈中途改也不漂移),沒快照才用現行鏈
    SELECT label, target_type INTO v_step_label, v_target_type
      FROM request_chain_snapshots
     WHERE request_type = v_snap_rt AND request_id = (v_new_json->>'id')::int
       AND step_order = COALESCE((v_new_json->>'current_step')::int, 0)
     LIMIT 1;
    IF v_step_label IS NULL THEN
      SELECT label, target_type INTO v_step_label, v_target_type
        FROM approval_chain_steps
       WHERE chain_id = v_chain_id
         AND step_order = COALESCE((v_new_json->>'current_step')::int, 0)
       LIMIT 1;
    END IF;

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

    -- 新關標籤同樣優先讀凍結快照
    SELECT label, target_type INTO v_step_label, v_target_type
      FROM request_chain_snapshots
     WHERE request_type = v_snap_rt AND request_id = (v_new_json->>'id')::int
       AND step_order = (v_new_json->>'current_step')::int
     LIMIT 1;
    IF v_step_label IS NULL THEN
      SELECT label, target_type INTO v_step_label, v_target_type
        FROM approval_chain_steps
       WHERE chain_id = v_chain_id
         AND step_order = (v_new_json->>'current_step')::int
       LIMIT 1;
    END IF;

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
