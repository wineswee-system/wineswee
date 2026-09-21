-- ════════════════════════════════════════════════════════════════════════════
-- 修 approval_step_history.approver_id 全為 null 問題
-- ────────────────────────────────────────────────────────────────────────────
-- 問題：trigger function (20260513220000) 只寫 approver_name 沒寫 approver_id
--      → 我的「已簽核」RPC 用 approver_id filter 撈不到任何 row。
--
-- 修 3 件：
--   1. _list_my_signed_approvals RPC 改用 (approver_id = me) OR (approver_name = me.name)
--      雙條件 fallback，新舊資料都 cover
--   2. Backfill 既有 row：用 approver_name lookup employees.name → 填 approver_id
--      （同 org 內名字唯一假設；「系統自動跳過」這類非真人 row 略過）
--   3. 改 trigger function 寫入 approver_id（新簽核當下就填好）
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Backfill 既有 row ──────────────────────────────────────────────────
UPDATE approval_step_history ash
   SET approver_id = e.id
  FROM employees e
 WHERE ash.approver_id IS NULL
   AND ash.approver_name IS NOT NULL
   AND ash.approver_name = e.name
   AND ash.approver_name NOT LIKE '%系統%'
   AND ash.approver_name NOT LIKE '%自動%'
   AND (ash.organization_id IS NULL OR e.organization_id = ash.organization_id);


-- ─── 2. 改 trigger function 寫入 approver_id ──────────────────────────────
-- 1:1 從 20260513220000 重寫，唯一新增是 v_approver_id lookup + UPDATE 加進去
CREATE OR REPLACE FUNCTION public._trg_ash_record_chain_step()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rt          text;
  v_new_json    jsonb;
  v_step_label  text;
  v_target_type text;
  v_approver    text;
  v_approver_id int;
  v_action      text;
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
    ELSE NULL
  END;
  IF v_rt IS NULL THEN RETURN NEW; END IF;

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

  -- ★ 新增：用 name 反查 emp_id（同 org 內名字應唯一）
  IF v_approver IS NOT NULL AND v_approver NOT LIKE '%系統%' AND v_approver NOT LIKE '%自動%' THEN
    SELECT id INTO v_approver_id FROM employees
     WHERE name = v_approver
       AND (NULLIF(v_new_json->>'organization_id','')::int IS NULL
            OR organization_id = (v_new_json->>'organization_id')::int)
     LIMIT 1;
  END IF;

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
           approver_name = COALESCE(v_approver, approver_name),
           approver_id   = COALESCE(v_approver_id, approver_id)
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
           approver_name = COALESCE(v_approver, approver_name),
           approver_id   = COALESCE(v_approver_id, approver_id)
     WHERE request_type = v_rt
       AND request_id = (v_new_json->>'id')::int
       AND exited_at IS NULL;
  END IF;

  RETURN NEW;
END $$;


-- ─── 3. 改 RPC 加 name fallback（雙保險，舊 row backfill 不全也能撈）─────
CREATE OR REPLACE FUNCTION public._list_my_signed_approvals(
  p_emp_id     INT,
  p_year_month TEXT
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_end   TIMESTAMPTZ;
  v_my_name TEXT;
  result  json;
BEGIN
  IF p_year_month IS NOT NULL THEN
    v_start := (p_year_month || '-01')::timestamptz;
    v_end   := v_start + INTERVAL '1 month';
  END IF;

  SELECT name INTO v_my_name FROM employees WHERE id = p_emp_id;

  WITH chain_signed AS (
    SELECT
      ash.request_type::text  AS source_type,
      ash.request_id          AS source_id,
      ash.action              AS my_action,
      ash.exited_at           AS signed_at,
      ash.step_order          AS step_order,
      ash.step_label          AS step_label,
      false                   AS is_extra
    FROM approval_step_history ash
    WHERE (ash.approver_id = p_emp_id
           OR (ash.approver_id IS NULL AND ash.approver_name = v_my_name
               AND ash.approver_name NOT LIKE '%系統%' AND ash.approver_name NOT LIKE '%自動%'))
      AND ash.action IN ('approved', 'rejected')
      AND ash.exited_at IS NOT NULL
      AND (p_year_month IS NULL OR (ash.exited_at >= v_start AND ash.exited_at < v_end))
  ),
  extra_signed AS (
    SELECT
      CASE es.source_table
        WHEN 'leave_requests'                THEN 'leave'
        WHEN 'overtime_requests'             THEN 'overtime'
        WHEN 'business_trips'                THEN 'trip'
        WHEN 'clock_corrections'             THEN 'correction'
        WHEN 'expenses'                      THEN 'expense'
        WHEN 'expense_requests'              THEN 'expense_request'
        WHEN 'resignation_requests'          THEN 'resignation'
        WHEN 'leave_of_absence_requests'     THEN 'loa'
        WHEN 'personnel_transfer_requests'   THEN 'transfer'
        WHEN 'headcount_requests'            THEN 'headcount'
        ELSE es.source_table
      END                     AS source_type,
      es.source_id            AS source_id,
      es.status               AS my_action,
      es.approved_at          AS signed_at,
      NULL::int               AS step_order,
      '加簽'                  AS step_label,
      true                    AS is_extra
    FROM approval_extra_steps es
    WHERE es.assignee_id = p_emp_id
      AND es.status IN ('approved', 'rejected')
      AND es.approved_at IS NOT NULL
      AND (p_year_month IS NULL OR (es.approved_at >= v_start AND es.approved_at < v_end))
  ),
  all_signed AS (
    SELECT * FROM chain_signed
    UNION ALL
    SELECT * FROM extra_signed
  )
  SELECT json_agg(json_build_object(
    'source_type',   source_type,
    'source_id',     source_id,
    'my_action',     my_action,
    'signed_at',     signed_at,
    'step_order',    step_order,
    'step_label',    step_label,
    'is_extra',      is_extra,
    'applicant_name', (
      CASE source_type
        WHEN 'leave'           THEN (SELECT employee FROM leave_requests       WHERE id = source_id)
        WHEN 'overtime'        THEN (SELECT employee FROM overtime_requests    WHERE id = source_id)
        WHEN 'trip'            THEN (SELECT employee FROM business_trips       WHERE id = source_id)
        WHEN 'correction'      THEN (SELECT employee FROM clock_corrections    WHERE id = source_id)
        WHEN 'expense'         THEN (SELECT employee FROM expenses             WHERE id = source_id)
        WHEN 'expense_request' THEN (SELECT employee FROM expense_requests     WHERE id = source_id)
        WHEN 'resignation'     THEN (SELECT e.name FROM resignation_requests r        LEFT JOIN employees e ON e.id = r.employee_id WHERE r.id = source_id)
        WHEN 'loa'             THEN (SELECT e.name FROM leave_of_absence_requests r   LEFT JOIN employees e ON e.id = r.employee_id WHERE r.id = source_id)
        WHEN 'transfer'        THEN (SELECT e.name FROM personnel_transfer_requests r LEFT JOIN employees e ON e.id = r.employee_id WHERE r.id = source_id)
        WHEN 'headcount'       THEN (SELECT e.name FROM headcount_requests r          LEFT JOIN employees e ON e.id = r.employee_id WHERE r.id = source_id)
      END
    ),
    'current_status', (
      CASE source_type
        WHEN 'leave'           THEN (SELECT status FROM leave_requests          WHERE id = source_id)
        WHEN 'overtime'        THEN (SELECT status FROM overtime_requests       WHERE id = source_id)
        WHEN 'trip'            THEN (SELECT status FROM business_trips          WHERE id = source_id)
        WHEN 'correction'      THEN (SELECT status FROM clock_corrections       WHERE id = source_id)
        WHEN 'expense'         THEN (SELECT status FROM expenses                WHERE id = source_id)
        WHEN 'expense_request' THEN (SELECT status FROM expense_requests        WHERE id = source_id)
        WHEN 'resignation'     THEN (SELECT status FROM resignation_requests    WHERE id = source_id)
        WHEN 'loa'             THEN (SELECT status FROM leave_of_absence_requests        WHERE id = source_id)
        WHEN 'transfer'        THEN (SELECT status FROM personnel_transfer_requests      WHERE id = source_id)
        WHEN 'headcount'       THEN (SELECT status FROM headcount_requests      WHERE id = source_id)
      END
    ),
    'summary', (
      CASE source_type
        WHEN 'leave'           THEN (SELECT type || ' · ' || start_date || ' ~ ' || COALESCE(end_date, start_date)::text FROM leave_requests WHERE id = source_id)
        WHEN 'overtime'        THEN (SELECT '加班 ' || date || ' (' || COALESCE(hours, 0)::text || 'h)' FROM overtime_requests WHERE id = source_id)
        WHEN 'trip'            THEN (SELECT COALESCE(destination, '出差') || ' · ' || start_date || ' ~ ' || COALESCE(end_date, start_date)::text FROM business_trips WHERE id = source_id)
        WHEN 'correction'      THEN (SELECT COALESCE(type, '補打卡') || ' · ' || date FROM clock_corrections WHERE id = source_id)
        WHEN 'expense'         THEN (SELECT title || ' · NT$ ' || COALESCE(amount, 0)::text FROM expenses WHERE id = source_id)
        WHEN 'expense_request' THEN (SELECT title || ' · NT$ ' || COALESCE(estimated_amount, 0)::text FROM expense_requests WHERE id = source_id)
        WHEN 'resignation'     THEN (SELECT '離職申請 · 預計 ' || COALESCE(planned_resign_date::text, '—') FROM resignation_requests WHERE id = source_id)
        WHEN 'loa'             THEN (SELECT '留停 · ' || COALESCE(reason_type, '—') FROM leave_of_absence_requests WHERE id = source_id)
        WHEN 'transfer'        THEN (SELECT COALESCE(transfer_type, '異動') || ' · 生效 ' || COALESCE(effective_date::text, '—') FROM personnel_transfer_requests WHERE id = source_id)
        WHEN 'headcount'       THEN (SELECT job_title || ' × ' || headcount::text || ' 人' FROM headcount_requests WHERE id = source_id)
      END
    )
  ) ORDER BY signed_at DESC)
  INTO result FROM all_signed;

  RETURN COALESCE(result, '[]'::json);
END $$;

GRANT EXECUTE ON FUNCTION public._list_my_signed_approvals(INT, TEXT) TO authenticated, anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
