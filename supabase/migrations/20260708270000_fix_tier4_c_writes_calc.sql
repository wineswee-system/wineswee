-- Tier4 C 組:寫入/計算類 4 支欄位/型別對齊 — 2026-07-08
-- calc_severance:salary_structures 真欄 effective_from(非 effective_date)。
-- secure_advance_workflow_step:v_caller_id 誤宣告 UUID 卻裝 employees.id(int)→改 INT(解 int=uuid);
--   tasks 無 confirmed/confirmed_by/confirmed_at 欄→UPDATE 拿掉三欄(保留 status/notes/completed_at)。
-- get_available_slots:前端傳 int store id,參數卻 uuid→改 integer(DROP 舊 uuid 簽章)。
-- earn_member_points_atomic:point_transactions 無 reason/operator 欄→改寫 type+organization_id
--   (原本 EXCEPTION 靜默跳過 ledger,修後真的入帳)。皆 idempotent。

CREATE OR REPLACE FUNCTION public.calc_severance(p_employee_id integer, p_termination_date date, p_avg_wage_override numeric DEFAULT NULL::numeric)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp                employees;
  v_service_days       INT;
  v_service_years      NUMERIC;
  v_avg_wage           NUMERIC;
  v_severance_months   NUMERIC;
  v_severance_amount   NUMERIC;
  v_notice_days        INT;
  v_notice_wage        NUMERIC;
  v_total              NUMERIC;
  v_payroll_avg        NUMERIC;
  v_struct_base        NUMERIC;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id;
  IF v_emp.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;
  IF v_emp.join_date IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'NO_JOIN_DATE',
                             'message', '此員工沒設到職日，無法計算服務年資');
  END IF;
  IF p_termination_date <= v_emp.join_date THEN
    RETURN json_build_object('ok', false, 'error', 'INVALID_TERMINATION_DATE',
                             'message', '離職日不可早於到職日');
  END IF;

  -- 服務年資（精確到天 → 年）
  v_service_days  := p_termination_date - v_emp.join_date;
  v_service_years := ROUND(v_service_days::numeric / 365.25, 3);

  -- 平均工資：撈離職前 6 個月 payroll_records.gross_salary 平均
  -- pay_period 格式 'YYYY-MM'
  IF p_avg_wage_override IS NOT NULL AND p_avg_wage_override > 0 THEN
    v_avg_wage := p_avg_wage_override;
  ELSE
    SELECT AVG(gross_salary) INTO v_payroll_avg
      FROM payroll_records
     WHERE employee_id = p_employee_id
       AND gross_salary > 0
       AND pay_period >= to_char(p_termination_date - INTERVAL '6 months', 'YYYY-MM')
       AND pay_period <  to_char(p_termination_date, 'YYYY-MM');

    IF v_payroll_avg IS NOT NULL AND v_payroll_avg > 0 THEN
      v_avg_wage := ROUND(v_payroll_avg, 2);
    ELSE
      -- fallback 到 salary_structures.base_salary
      SELECT base_salary INTO v_struct_base
        FROM salary_structures
       WHERE employee_id = p_employee_id
       ORDER BY effective_from DESC NULLS LAST, id DESC
       LIMIT 1;
      v_avg_wage := COALESCE(v_struct_base, 0);
    END IF;
  END IF;

  -- 資遣月數 = min(服務年資 × 0.5, 6)
  v_severance_months := LEAST(v_service_years * 0.5, 6.0);
  v_severance_amount := ROUND(v_severance_months * v_avg_wage, 2);

  -- 預告天數（勞基法 16 條）
  IF v_service_days < 90 THEN
    v_notice_days := 0;  -- 未滿 3 個月不需預告
  ELSIF v_service_years < 1 THEN
    v_notice_days := 10;
  ELSIF v_service_years < 3 THEN
    v_notice_days := 20;
  ELSE
    v_notice_days := 30;
  END IF;

  -- 預告工資（如未實際預告才付）：日薪 × 預告天數
  -- 日薪以「平均月薪 ÷ 30」估算
  v_notice_wage := ROUND(v_avg_wage / 30 * v_notice_days, 2);

  v_total := v_severance_amount + v_notice_wage;

  RETURN json_build_object(
    'ok', true,
    'employee_id', v_emp.id,
    'employee_name', v_emp.name,
    'employee_number', v_emp.employee_number,
    'join_date', v_emp.join_date,
    'termination_date', p_termination_date,
    'service_days', v_service_days,
    'service_years', v_service_years,
    'service_label', floor(v_service_years)::text || ' 年 ' ||
                     round((v_service_years - floor(v_service_years)) * 12)::text || ' 個月',
    'average_monthly_wage', v_avg_wage,
    'avg_wage_source', CASE
      WHEN p_avg_wage_override IS NOT NULL THEN 'manual'
      WHEN v_payroll_avg IS NOT NULL THEN 'payroll_6m_avg'
      ELSE 'salary_structure'
    END,
    'severance_months', v_severance_months,
    'severance_amount', v_severance_amount,
    'notice_days', v_notice_days,
    'notice_wage', v_notice_wage,
    'total_amount', v_total
  );
END $function$;

CREATE OR REPLACE FUNCTION public.secure_advance_workflow_step(p_step_id integer, p_action text, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id    INT;
  v_caller_name  TEXT;
  v_step_row     RECORD;
  v_caller_role  TEXT;
  v_caller_org   INT;
  v_new_status   TEXT;
  v_rows_updated INT;
BEGIN

  -- 1. Identify caller (prefer auth_user_id, fall back to email)
  SELECT id, name
  INTO   v_caller_id, v_caller_name
  FROM   public.employees
  WHERE  auth_user_id = auth.uid()
     OR  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST
  LIMIT  1;

  IF v_caller_name IS NULL THEN
    RAISE EXCEPTION '呼叫者身份無法識別：找不到對應的員工記錄';
  END IF;

  v_caller_role := public.current_employee_role();
  v_caller_org  := public.current_employee_org();

  -- 2. Fetch the step + its workflow instance, scoped to caller's org (H-2)
  SELECT
    t.id              AS step_id,
    t.status          AS step_status,
    t.assignee        AS step_assignee,
    wi.id             AS instance_id,
    wi.started_by     AS instance_started_by,
    wi.started_by_id  AS instance_started_by_id
  INTO v_step_row
  FROM  public.tasks t
  JOIN  public.workflow_instances wi ON wi.id = t.workflow_instance_id
  WHERE t.id     = p_step_id
    AND t.status = '待處理'
    AND (
      v_caller_role IN ('admin', 'super_admin')
      OR t.organization_id  = v_caller_org
      OR wi.organization_id = v_caller_org
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION '步驟不存在或已處理';
  END IF;

  -- 3. Self-approval guard (H-1)
  --    Primary: compare by UUID (immune to name changes or cross-org collisions)
  --    Fallback: compare by name for legacy records without started_by_id
  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    IF v_step_row.instance_started_by_id IS NOT NULL THEN
      IF v_step_row.instance_started_by_id = v_caller_id THEN
        RAISE EXCEPTION '不得自行核准：申請人不可審核自己的申請';
      END IF;
    ELSIF v_step_row.instance_started_by = v_caller_name THEN
      RAISE EXCEPTION '不得自行核准：申請人不可審核自己的申請';
    END IF;
  END IF;

  -- 4. Assignee guard
  IF v_step_row.step_assignee IS NOT NULL
     AND v_step_row.step_assignee != v_caller_name
     AND v_caller_role NOT IN ('admin', 'super_admin')
  THEN
    RAISE EXCEPTION '不得代替他人審核：您不是本步驟的指定審核人';
  END IF;

  -- 5. Compute new status
  v_new_status := CASE WHEN p_action = '核准' THEN '已完成' ELSE '已退回' END;

  -- 6. UPDATE with optimistic lock
  UPDATE public.tasks
  SET
    status       = v_new_status,
    notes        = p_comment,
    completed_at = CASE WHEN p_action = '核准' THEN now() ELSE NULL END
  WHERE id     = p_step_id
    AND status = '待處理';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION 'step_already_processed';
  END IF;

  -- 7. Return result
  RETURN jsonb_build_object(
    'confirmed_by', v_caller_name,
    'step_id',      p_step_id,
    'action',       p_action
  );

END;
$function$;

DROP FUNCTION IF EXISTS public.get_available_slots(uuid, date, integer, integer);
CREATE OR REPLACE FUNCTION public.get_available_slots(p_store_id integer, p_date date, p_party_size integer, p_duration_hours integer)
 RETURNS TABLE(slot_time time without time zone, available_table_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rule        reservation_rules%ROWTYPE;
  v_dow         SMALLINT;
  v_slot        TIME;
  v_slot_end    TIME;
  v_last_allow  TIME;
  v_available   INT;
BEGIN
  v_dow := EXTRACT(DOW FROM p_date)::SMALLINT;
  SELECT * INTO v_rule FROM reservation_rules r
  WHERE r.store_id = p_store_id
  ORDER BY CASE
    WHEN r.date_override = p_date                             THEN 0
    WHEN r.day_of_week = v_dow AND r.date_override IS NULL    THEN 1
    WHEN r.day_of_week IS NULL  AND r.date_override IS NULL   THEN 2
    ELSE 99
  END LIMIT 1;

  IF v_rule IS NULL OR v_rule.is_closed THEN RETURN; END IF;
  IF p_party_size < 1 OR p_party_size > v_rule.max_party_size THEN RETURN; END IF;
  IF p_duration_hours < v_rule.min_booking_hours OR p_duration_hours > v_rule.max_booking_hours THEN RETURN; END IF;

  v_last_allow := v_rule.close_time - make_interval(mins => p_duration_hours * 60 + v_rule.end_buffer_minutes);
  v_slot := v_rule.open_time;

  WHILE v_slot <= v_last_allow LOOP
    v_slot_end := v_slot + make_interval(mins => p_duration_hours * 60);
    SELECT COUNT(*) INTO v_available
    FROM res_tables t
    WHERE t.store_id = p_store_id AND t.is_active = TRUE AND t.capacity >= p_party_size
      AND NOT EXISTS (
        SELECT 1 FROM reservations r2
        WHERE r2.table_id      = t.id
          AND r2.reserved_date = p_date
          AND r2.status        NOT IN ('cancelled','no_show','completed')
          AND r2.slot_time < (v_slot_end + make_interval(mins => v_rule.buffer_minutes))
          AND (r2.slot_time + make_interval(mins => (r2.duration_hours + r2.extended_hours) * 60)) > v_slot
      );
    IF v_available > 0 THEN
      slot_time             := v_slot;
      available_table_count := v_available;
      RETURN NEXT;
    END IF;
    v_slot := v_slot + make_interval(mins => v_rule.slot_interval_minutes);
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.earn_member_points_atomic(p_member_id integer, p_points_delta integer, p_amount numeric DEFAULT 0, p_reason text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text, p_operator text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_member members;
  v_new_total int;
  v_new_avail int;
BEGIN
  -- Lock member row
  SELECT * INTO v_member FROM members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'MEMBER_NOT_FOUND');
  END IF;

  v_new_total := COALESCE(v_member.total_points, 0) + GREATEST(p_points_delta, 0);
  v_new_avail := GREATEST(0, COALESCE(v_member.available_points, 0) + p_points_delta);

  UPDATE members SET
    total_points     = v_new_total,
    available_points = v_new_avail,
    total_spent      = COALESCE(total_spent, 0) + GREATEST(p_amount, 0),
    visit_count      = COALESCE(visit_count, 0) + (CASE WHEN p_amount > 0 THEN 1 ELSE 0 END),
    last_visit       = CASE WHEN p_amount > 0 THEN CURRENT_DATE ELSE last_visit END
  WHERE id = p_member_id;

  -- 寫一筆異動紀錄（point_transactions schema 簡化使用：member_id, points, type, reason）
  BEGIN
    INSERT INTO point_transactions (member_id, points, type, organization_id)
    VALUES (p_member_id, p_points_delta,
            CASE WHEN p_points_delta >= 0 THEN '累積' ELSE '使用' END,
            v_member.organization_id);
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    -- point_transactions schema 不一致時不阻擋主操作（會員點數仍正確）
    NULL;
  END;

  RETURN json_build_object(
    'ok', true,
    'member_id', p_member_id,
    'total_points', v_new_total,
    'available_points', v_new_avail
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
