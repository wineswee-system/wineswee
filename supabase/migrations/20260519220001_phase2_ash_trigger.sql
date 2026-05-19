-- ════════════════════════════════════════════════════════════════════════════
-- form_submissions chain advance Phase 2 (1/3):
--   ash trigger function 重寫 + 掛 trigger 到 form_submissions
-- ────────────────────────────────────────────────────────────────────────────
-- 切檔原因：20260519220000 整包跑會 deadlock（lock 太多表）
-- 這檔只動 _trg_ash_record_chain_step + form_submissions 一張表 → 不會撞
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. 改 ash trigger function 認 form_submissions ────────────────────────
-- 1:1 重寫 20260519150000，唯一新增是 CASE 多一條 'form_submission'
-- 注意：form_submissions 的 chain_id 來自 join template，trigger 內 NEW 沒這欄位
-- → 用 SELECT approval_chain_id FROM form_templates WHERE id = NEW.template_id
CREATE OR REPLACE FUNCTION public._trg_ash_record_chain_step()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rt          text;
  v_new_json    jsonb;
  v_old_json    jsonb;
  v_step_label  text;
  v_target_type text;
  v_approver    text;
  v_approver_id int;
  v_action      text;
  v_chain_id    int;  -- ★ 新增：form_submissions 從 template 拿 chain_id
BEGIN
  v_rt := CASE TG_TABLE_NAME
    WHEN 'leave_requests'        THEN 'leave'
    WHEN 'overtime_requests'     THEN 'overtime'
    WHEN 'business_trips'        THEN 'trip'
    WHEN 'clock_corrections'     THEN 'correction'
    WHEN 'expenses'              THEN 'expense'
    WHEN 'expense_requests'      THEN 'expense_request'
    WHEN 'resignation_requests'  THEN 'resignation'
    WHEN 'leave_of_absence_requests'     THEN 'loa'
    WHEN 'personnel_transfer_requests'   THEN 'transfer'
    WHEN 'headcount_requests'    THEN 'headcount'
    WHEN 'form_submissions'      THEN 'form_submission'
    ELSE NULL
  END;
  IF v_rt IS NULL THEN RETURN NEW; END IF;

  v_new_json := to_jsonb(NEW);

  -- form_submissions 從 template 抓 chain_id (其他表 chain_id 在 NEW 內)
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

  -- 用 name 反查 emp_id
  IF v_approver IS NOT NULL AND v_approver NOT LIKE '%系統%' AND v_approver NOT LIKE '%自動%' THEN
    SELECT id INTO v_approver_id FROM employees
     WHERE name = v_approver
       AND (NULLIF(v_new_json->>'organization_id','')::int IS NULL
            OR organization_id = (v_new_json->>'organization_id')::int)
     LIMIT 1;
  END IF;

  -- form_submissions 沒「approver」字串只有 approver_id；改用 approver_id 直接抓
  IF v_rt = 'form_submission' AND v_approver_id IS NULL THEN
    v_approver_id := NULLIF(v_new_json->>'approver_id', '')::int;
    IF v_approver_id IS NOT NULL THEN
      SELECT name INTO v_approver FROM employees WHERE id = v_approver_id;
    END IF;
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
END $$;


-- ─── 2. 掛 trigger to form_submissions ─────────────────────────────────────
DROP TRIGGER IF EXISTS trg_log_approval_step_history ON public.form_submissions;
CREATE TRIGGER trg_log_approval_step_history
  AFTER INSERT OR UPDATE ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public._trg_ash_record_chain_step();

COMMIT;

NOTIFY pgrst, 'reload schema';
