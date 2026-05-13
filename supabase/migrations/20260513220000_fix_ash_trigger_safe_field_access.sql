-- 修 trg_log_approval_step_history 跨表 schema drift
-- 2026-05-13
--
-- Bug: trigger 直接寫 NEW.approver / NEW.approved_by，但不同表欄位不同：
--   leave_requests / overtime_requests / business_trips / clock_corrections / expenses 有 approver
--   expense_requests 只有 approved_by（沒 approver）
--   resignation_requests / leave_of_absence_requests / personnel_transfer_requests 都沒
-- 結果：trigger 在 expense_requests 上 fire 時 NEW.approver → 42703 column does not exist
-- 慘案重現：羅紹輝 #54 經費申請從 LINE 點核准，PG 拋
--   `record "new" has no field "approver"`
--
-- 修法：用 to_jsonb(NEW)->>'col' 安全取值，欄位不存在回 NULL 不會炸
--
-- 重新掛 trigger 到所有 9 個表（之前 migration 20260513090000 + 20260513140000 都掛了）

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_log_approval_step_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rt          TEXT;
  v_step_label  TEXT;
  v_target_type TEXT;
  v_action      TEXT;
  v_new_json    jsonb;
  v_approver    TEXT;
BEGIN
  v_rt := CASE TG_TABLE_NAME
    WHEN 'leave_requests'              THEN 'leave'
    WHEN 'overtime_requests'           THEN 'overtime'
    WHEN 'business_trips'              THEN 'trip'
    WHEN 'clock_corrections'           THEN 'correction'
    WHEN 'expenses'                    THEN 'expense'
    WHEN 'expense_requests'            THEN 'expense_request'
    WHEN 'resignation_requests'        THEN 'resignation'
    WHEN 'leave_of_absence_requests'   THEN 'loa'
    WHEN 'personnel_transfer_requests' THEN 'transfer'
    ELSE NULL
  END;
  IF v_rt IS NULL THEN RETURN NEW; END IF;

  -- 跨表安全取值：把 NEW 整列轉 jsonb，欄位不存在 ->> 回 NULL 不報錯
  v_new_json := to_jsonb(NEW);

  -- INSERT：起手寫第一筆 entered
  IF TG_OP = 'INSERT' AND (v_new_json->>'approval_chain_id') IS NOT NULL THEN
    SELECT label, target_type INTO v_step_label, v_target_type
      FROM approval_chain_steps
     WHERE chain_id = (v_new_json->>'approval_chain_id')::int
       AND step_order = COALESCE((v_new_json->>'current_step')::int, 0)
     LIMIT 1;

    INSERT INTO approval_step_history (
      request_type, request_id, organization_id, chain_id,
      step_order, step_label, target_type, entered_at, action
    ) VALUES (
      v_rt,
      (v_new_json->>'id')::int,
      NULLIF(v_new_json->>'organization_id','')::int,
      (v_new_json->>'approval_chain_id')::int,
      COALESCE((v_new_json->>'current_step')::int, 0),
      v_step_label, v_target_type,
      now(), 'submitted'
    );
    RETURN NEW;
  END IF;

  v_approver := COALESCE(v_new_json->>'approver', v_new_json->>'approved_by');

  -- UPDATE OF current_step：上一關 exit + 新關 entered
  IF TG_OP = 'UPDATE'
     AND (v_new_json->>'current_step') IS DISTINCT FROM (to_jsonb(OLD)->>'current_step')
     AND (v_new_json->>'approval_chain_id') IS NOT NULL THEN
    UPDATE approval_step_history
       SET exited_at = now(),
           action = CASE
             WHEN (v_new_json->>'status') IN ('已退回','已駁回') THEN 'rejected'
             ELSE 'approved'
           END,
           approver_name = COALESCE(v_approver, approver_name)
     WHERE request_type = v_rt
       AND request_id = (v_new_json->>'id')::int
       AND step_order = COALESCE((to_jsonb(OLD)->>'current_step')::int, 0)
       AND exited_at IS NULL;

    SELECT label, target_type INTO v_step_label, v_target_type
      FROM approval_chain_steps
     WHERE chain_id = (v_new_json->>'approval_chain_id')::int
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
        (v_new_json->>'approval_chain_id')::int,
        (v_new_json->>'current_step')::int,
        v_step_label, v_target_type,
        now(), 'pending'
      );
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE OF status：終態關 exit
  IF TG_OP = 'UPDATE'
     AND (v_new_json->>'status') IS DISTINCT FROM (to_jsonb(OLD)->>'status')
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
           approver_name = COALESCE(v_approver, approver_name)
     WHERE request_type = v_rt
       AND request_id = (v_new_json->>'id')::int
       AND exited_at IS NULL;
  END IF;

  RETURN NEW;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- 驗證：
-- DO $$ BEGIN
--   PERFORM expense_request_step_advance(54, 'approve', NULL);
-- END $$;
