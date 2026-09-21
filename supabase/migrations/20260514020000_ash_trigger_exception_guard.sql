-- ============================================================
-- approval_step_history trigger 加 EXCEPTION 防呆
-- 2026-05-14
--
-- 背景：
--   2026-05-13 ASH trigger 上線當天踩 2 次 bug（field access not-null）
--   雖然 trigger 本身已用 `to_jsonb(NEW)->>field` 安全取值改好，
--   但只要 ASH 邏輯有任何意外 error，會中斷整個 INSERT/UPDATE 的
--   trigger chain，導致後續 notify trigger 來不及 fire → LINE 漏推。
--
--   #55 (2026-05-13 11:02) 漏推給張啟達就是這個慘案。
--
-- 解法：
--   把整個 ASH 邏輯包在 BEGIN ... EXCEPTION WHEN OTHERS THEN ... END。
--   任何錯誤 → 寫一筆 audit_logs，但 swallow exception，
--   讓主流程跟後續 trigger 繼續跑（簽核 LINE 通知不會被連坐）。
--
-- 設計考量：
--   - ASH log 漏寫 < 員工沒收到 LINE
--     寧可 ASH 偶爾漏一筆 audit log，也不要讓員工漏 LINE 通知
--   - audit_logs INSERT 也包 EXCEPTION，audit table 本身爆了也吞掉
--     防止 ASH error handler 自己又連坐
--   - 業務邏輯零變動，只加防呆殼
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_log_approval_step_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rt          TEXT;
  v_step_label  TEXT;
  v_target_type TEXT;
  v_action      TEXT;
  v_new_json    jsonb;
  v_approver    TEXT;
BEGIN
  -- ═══ EXCEPTION 防呆殼開始 ═══
  -- 任何錯誤都吞掉並寫 audit_logs，不阻斷主流程 / 後續 trigger
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
  -- ═══ EXCEPTION 防呆殼結束 ═══
  EXCEPTION WHEN OTHERS THEN
    -- ASH 邏輯失敗 → 寫 audit_logs 但不擋主流程
    BEGIN
      INSERT INTO audit_logs (
        action, target_table, target_id, new_data, time
      ) VALUES (
        'ash_trigger_error',
        TG_TABLE_NAME,
        COALESCE((to_jsonb(NEW)->>'id')::int, 0),
        jsonb_build_object(
          'sqlstate', SQLSTATE,
          'sqlerrm',  SQLERRM,
          'tg_op',    TG_OP,
          'row',      to_jsonb(NEW)
        ),
        now()
      );
    EXCEPTION WHEN OTHERS THEN
      -- audit_logs 本身爆掉也吞掉，絕不讓主流程被擋
      NULL;
    END;
  END;

  RETURN NEW;
END $function$;

COMMIT;

-- 驗證：trigger function 應該存在且回傳 trigger type
SELECT proname, pronargs FROM pg_proc WHERE proname = 'trg_log_approval_step_history';
