-- 請假 LINE 簽核卡(_push_leave_flex)改「時數」為單位(讀班表淨時數) — 2026-08-07
-- 這是提交時主管收到的統一簽核卡(PG hand-roll flex,DB trigger 推),非 LIFF/edge。
-- 只改天數段→時數(COALESCE 填的hours→Σ排班淨時數→days*8),整支其餘逐字保留(dump live)。
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._push_leave_flex(p_line_user_id text, p_liff_id text, p_id integer, p_event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row leave_requests;
  v_emp_name text; v_dept text;
  v_text_label   CONSTANT text := '#9CA3AF';
  v_text_body    CONSTANT text := '#333333';
  v_color_danger CONSTANT text := '#dc2626';
  v_extra jsonb := '[]'::jsonb;
  v_reason jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_row FROM leave_requests WHERE id = p_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  -- 申請人 + 部門
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
        jsonb_build_object('type','text','text','類型','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text', COALESCE(v_row.type, '—'),
          'size','sm','color',v_text_body,'weight','bold','flex',5)
      )
    ),
    jsonb_build_object(
      'type','box','layout','horizontal','margin','sm',
      'contents', jsonb_build_array(
        jsonb_build_object('type','text','text','期間','size','sm','color',v_text_label,'flex',2),
        jsonb_build_object('type','text','text',
          to_char(v_row.start_date, 'YYYY-MM-DD') ||
          CASE WHEN v_row.end_date IS NOT NULL AND v_row.end_date <> v_row.start_date
               THEN ' ~ ' || to_char(v_row.end_date, 'YYYY-MM-DD') ELSE '' END,
          'size','sm','color',v_text_body,'flex',5,'wrap',true)
      )
    )
  );

  IF v_row.days IS NOT NULL OR v_row.hours IS NOT NULL THEN
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object(
        'type','box','layout','horizontal','margin','sm',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','時數','size','sm','color',v_text_label,'flex',2),
          jsonb_build_object('type','text','text', COALESCE(v_row.hours, (SELECT SUM(public._scheduled_net_hours(v_row.employee_id, g::date)) FROM generate_series(v_row.start_date, COALESCE(v_row.end_date, v_row.start_date), interval '1 day') g), COALESCE(v_row.days,0)*8)::text || ' 小時',
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
  ELSIF COALESCE(btrim(v_row.reason), '') <> '' THEN
    v_reason := jsonb_build_array(
      jsonb_build_object('type','separator','margin','md'),
      jsonb_build_object(
        'type','box','layout','vertical','margin','sm','paddingAll','10px',
        'backgroundColor','#F9FAFB','cornerRadius','8px',
        'contents', jsonb_build_array(
          jsonb_build_object('type','text','text','📝 請假原因','size','xxs','color',v_text_label,'weight','bold'),
          jsonb_build_object('type','text','text', v_row.reason,
            'size','sm','color',v_text_body,'wrap',true,'margin','sm')
        )
      )
    );
  END IF;

  PERFORM public._push_hr_chain_flex(
    p_line_user_id, p_liff_id, 'leave', p_id,
    v_emp_name, v_dept, p_event, v_extra, v_reason
  );
END $function$

