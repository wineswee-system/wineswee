-- 修 schema 漂移壞函式:希望休 + 認領代班 — 2026-07-16
-- 資安/函式健檢抓到:
--   1. liff_insert_off_request:INSERT off_requests(reason)但該表無 reason 欄→送出42703
--   2. _push_off_request_flex:ELSIF v_row.reason(無此欄)→希望休 trigger 連 flex 一起炸,整筆rollback
--   3. liff_claim_cover_request:INSERT schedules(store)但該表用 source_store→認領代班42703
-- 修法:1/2 拿掉 reason(LIFF 一律傳 null、功能沒真的收原因);3 store→source_store。
-- 全部 dump live 定義精準改。idempotent。

CREATE OR REPLACE FUNCTION public.liff_insert_off_request(p_line_user_id text, p_date date, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp           employees;
  v_supervisor  INT;
  v_status      TEXT := '待審核';
  new_id        INT;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  IF p_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PAST_DATE');
  END IF;

  -- 同日重複 → 不處理（client 應 toggle 而不是重送）
  IF EXISTS (SELECT 1 FROM public.off_requests WHERE employee_id = emp.id AND date = p_date) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DUPLICATE');
  END IF;

  -- 申請人是組織頂端 → 自動核准
  v_supervisor := public._resolve_single_approver(emp.id);
  IF v_supervisor IS NULL AND NOT public._is_store_manager(emp.id) THEN
    v_status := '已核准';
  END IF;

  INSERT INTO public.off_requests (
    employee, employee_id, date, status, organization_id, store
  )
  VALUES (
    emp.name, emp.id, p_date, v_status, emp.organization_id, emp.store
  )
  RETURNING id INTO new_id;

  RETURN jsonb_build_object(
    'id', new_id,
    'status', v_status,
    'auto_approved', v_status = '已核准'
  );
END $function$
;

CREATE OR REPLACE FUNCTION public.liff_claim_cover_request(p_line_user_id text, p_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp        employees;
  v_claimed  record;
BEGIN
  SELECT * INTO emp FROM public._liff_resolve_employee(p_line_user_id);
  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMPLOYEE_NOT_FOUND');
  END IF;

  -- 雙保險：同一筆只能成立一次（原子）
  UPDATE public.shift_cover_requests
     SET status = '已成立',
         claimed_by_emp_id = emp.id,
         claimed_by_name = emp.name,
         claimed_at = now()
   WHERE id = p_id
     AND status = '招募中'
     AND emp.id = ANY(invited_emp_ids)
     AND (expires_at IS NULL OR expires_at > now())
   RETURNING * INTO v_claimed;

  IF v_claimed.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOO_LATE_OR_NOT_ELIGIBLE');
  END IF;

  -- 認領者是否當天已有班？(雙重檢查)
  IF EXISTS (
    SELECT 1 FROM public.schedules
     WHERE date = v_claimed.shift_date
       AND (employee_id = emp.id OR employee = emp.name)
       AND shift IS NOT NULL AND shift <> '' AND shift <> '休'
  ) THEN
    -- rollback 認領
    UPDATE public.shift_cover_requests
       SET status = '招募中', claimed_by_emp_id = NULL, claimed_by_name = NULL, claimed_at = NULL
     WHERE id = p_id;
    RETURN jsonb_build_object('ok', false, 'error', 'YOU_ALREADY_HAVE_SHIFT');
  END IF;

  -- 寫入/覆蓋認領者的 schedules
  -- 用 UPSERT 處理「原本是 休 / 沒排班」兩種情況
  INSERT INTO public.schedules (
    employee, employee_id, date, shift, source_store,
    actual_start, actual_end, actual_hours, organization_id
  )
  VALUES (
    emp.name, emp.id, v_claimed.shift_date, v_claimed.shift_label, v_claimed.store,
    v_claimed.actual_start, v_claimed.actual_end, v_claimed.actual_hours,
    v_claimed.organization_id
  )
  ON CONFLICT (employee, date) DO UPDATE SET
    shift = EXCLUDED.shift,
    actual_start = EXCLUDED.actual_start,
    actual_end = EXCLUDED.actual_end,
    actual_hours = EXCLUDED.actual_hours,
    employee_id = EXCLUDED.employee_id,
    source_store = COALESCE(public.schedules.source_store, EXCLUDED.source_store);

  RETURN jsonb_build_object(
    'ok', true,
    'requester_emp_id', v_claimed.requester_id,
    'absent_emp_name', v_claimed.absent_emp_name,
    'shift_date', v_claimed.shift_date,
    'shift_label', v_claimed.shift_label,
    'invited_emp_ids', to_jsonb(v_claimed.invited_emp_ids),
    'claimer_name', emp.name
  );
END $function$
;

CREATE OR REPLACE FUNCTION public._push_off_request_flex(p_line_user_id text, p_liff_id text, p_id integer, p_event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row off_requests;
  v_emp_name text; v_dept text;
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';
  v_color_danger CONSTANT text := '#dc2626';
  v_extra jsonb := '[]'::jsonb;
  v_reason jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_row FROM off_requests WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  IF v_row.employee_id IS NOT NULL THEN
    SELECT e.name, COALESCE(d.name, e.dept) INTO v_emp_name, v_dept
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.id = v_row.employee_id;
  ELSE
    v_emp_name := v_row.employee;
  END IF;

  v_extra := jsonb_build_array(
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','日期','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', to_char(v_row.date, 'YYYY-MM-DD'),
          'size','sm','color',v_text_body,'weight','bold','flex',5)
      )
    )
  );

  IF v_row.store IS NOT NULL AND v_row.store <> '' THEN
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','門市','size','sm','color',v_text_label,'flex',2),
          jsonb_build_object('type','text','text', v_row.store,
            'size','sm','color',v_text_body,'flex',5)
        )
      )
    );
  END IF;

  IF p_event = 'request_rejected' AND COALESCE(btrim(v_row.reject_reason), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#FEF2F2','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','❌ 退回原因','size','xxs','color',v_color_danger,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reject_reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  PERFORM public._push_hr_chain_flex(
    p_line_user_id, p_liff_id, 'off_request', p_id,
    v_emp_name, v_dept, p_event, v_extra, v_reason
  );
END $function$
;

NOTIFY pgrst, 'reload schema';
